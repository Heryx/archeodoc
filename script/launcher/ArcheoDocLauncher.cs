using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

class ArcheoDocLauncher
{
    static string root;
    static string logPath;

    static readonly string[] SourcePaths = {
        "client/src", "server", "shared", "package.json", "tsconfig.json",
        "vite.config.ts", "script/build.ts"
    };
    static readonly string[] DistPaths = { "dist/index.cjs", "dist/public/index.html" };

    static void Main()
    {
        // exe lives directly in the project root
        root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        Directory.SetCurrentDirectory(root);
        Directory.CreateDirectory(Path.Combine(root, "uploads"));
        Directory.CreateDirectory(Path.Combine(root, "logs"));
        logPath = Path.Combine(root, "logs", "archeodoc.log");

        Console.Title = "ArcheoDoc - Documentazione Scavo";
        Console.WriteLine();
        Console.WriteLine(" ================================================");
        Console.WriteLine("  ArcheoDoc - Documentazione Scavo Archeologico");
        Console.WriteLine(" ================================================");
        Console.WriteLine();

        Log("========================================");
        Log(" ArcheoDoc avviato il " + DateTime.Now);
        Log("========================================");

        if (!CheckNode())
        {
            Log(" ERRORE: Node.js non trovato.");
            Process.Start("notepad.exe", logPath);
            Environment.Exit(1);
        }

        EnsureDependencies();
        EnsureBuild();
        KillPreviousServer();

        Console.WriteLine();
        Console.WriteLine(" ================================================");
        Console.WriteLine("  Server in avvio su http://localhost:5000");
        Console.WriteLine("  Il browser si aprira' automaticamente.");
        Console.WriteLine("  Per chiudere il server: chiudi questa finestra");
        Console.WriteLine(" ================================================");
        Console.WriteLine();

        string noRun = Environment.GetEnvironmentVariable("ARCHEODOC_NO_RUN");
        if (noRun != null && noRun.Trim() == "1")
        {
            Console.WriteLine(" Modalita test: avvio server saltato (ARCHEODOC_NO_RUN=1).");
            return;
        }

        // Avvia l'apertura del browser in background: appena il server risponde su porta 5000, apre la pagina
        var browserThread = new System.Threading.Thread(() =>
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 15000)
            {
                try
                {
                    var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:5000/");
                    req.Timeout = 200;
                    using (var resp = (System.Net.HttpWebResponse)req.GetResponse())
                    {
                        if ((int)resp.StatusCode >= 200)
                        {
                            Process.Start(new ProcessStartInfo("http://localhost:5000") { UseShellExecute = true });
                            return;
                        }
                    }
                }
                catch
                {
                    System.Threading.Thread.Sleep(50);
                }
            }
            // Fallback
            try { Process.Start(new ProcessStartInfo("http://localhost:5000") { UseShellExecute = true }); } catch { }
        });
        browserThread.IsBackground = true;
        browserThread.Start();

        RunServer();
    }

    static void Log(string line)
    {
        File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8);
    }

    static bool CheckNode()
    {
        try
        {
            var psi = new ProcessStartInfo("node", "--version")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode == 0;
            }
        }
        catch
        {
            return false;
        }
    }

    static string HashFile(string relativePath)
    {
        string full = Path.Combine(root, relativePath);
        if (!File.Exists(full)) return null;
        using (var sha = SHA256.Create())
        using (var stream = File.OpenRead(full))
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }
    }

    static void EnsureDependencies()
    {
        string lockFile = File.Exists(Path.Combine(root, "package-lock.json"))
            ? "package-lock.json" : "package.json";
        string currentHash = HashFile(lockFile);
        string markerPath = Path.Combine(root, "node_modules", ".archeodoc_deps_hash");
        string savedHash = File.Exists(markerPath) ? File.ReadAllText(markerPath).Trim() : null;

        bool nodeModulesMissing = !Directory.Exists(Path.Combine(root, "node_modules"));

        if (!nodeModulesMissing && currentHash != null && currentHash == savedHash)
        {
            Console.WriteLine(" Dipendenze aggiornate, salto npm install.");
            return;
        }

        Console.WriteLine(" Verifica/installazione dipendenze (npm install)...");
        Log(" Verifica dipendenze...");
        int code = RunCommandToLog("npm", "install");
        if (code != 0)
        {
            Log(" ERRORE durante l'installazione delle dipendenze.");
            Process.Start("notepad.exe", logPath);
            Environment.Exit(1);
        }
        if (currentHash != null)
        {
            Directory.CreateDirectory(Path.Combine(root, "node_modules"));
            File.WriteAllText(markerPath, currentHash);
        }
    }

    static DateTime LatestWrite(string[] paths)
    {
        DateTime latest = DateTime.MinValue;
        foreach (var p in paths)
        {
            string full = Path.Combine(root, p);
            if (Directory.Exists(full))
            {
                foreach (var f in Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories))
                {
                    var t = File.GetLastWriteTimeUtc(f);
                    if (t > latest) latest = t;
                }
            }
            else if (File.Exists(full))
            {
                var t = File.GetLastWriteTimeUtc(full);
                if (t > latest) latest = t;
            }
        }
        return latest;
    }

    static void EnsureBuild()
    {
        var latestSource = LatestWrite(SourcePaths);
        var latestDist = LatestWrite(DistPaths);

        bool buildNeeded = latestSource == DateTime.MinValue
            || latestDist == DateTime.MinValue
            || latestSource > latestDist;

        if (!buildNeeded)
        {
            Console.WriteLine(" Build aggiornata, salto compilazione.");
            return;
        }

        Console.WriteLine(" Sorgenti aggiornati, eseguo build...");
        int code = RunCommandToLog("npm", "run build");
        if (code != 0)
        {
            Log(" ERRORE durante la build. Controlla logs\\archeodoc.log");
            Process.Start("notepad.exe", logPath);
            Environment.Exit(1);
        }
    }

    static int RunCommandToLog(string cmd, string args)
    {
        var psi = new ProcessStartInfo("cmd.exe", "/c " + cmd + " " + args)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = root
        };
        using (var p = Process.Start(psi))
        {
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            p.WaitForExit();
            File.AppendAllText(logPath, stdout, Encoding.UTF8);
            File.AppendAllText(logPath, stderr, Encoding.UTF8);
            return p.ExitCode;
        }
    }

    static void KillPreviousServer()
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c netstat -ano | findstr :5000")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using (var p = Process.Start(psi))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                var match = Regex.Match(output, @"LISTENING\s+(\d+)");
                if (match.Success)
                {
                    string pid = match.Groups[1].Value;
                    Console.WriteLine(" Chiudo processo precedente (PID " + pid + ")...");
                    Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + pid + " /F")
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }).WaitForExit();
                }
            }
        }
        catch { }
        System.Threading.Thread.Sleep(300);
    }

    static void RunServer()
    {
        var psi = new ProcessStartInfo("node", "dist\\index.cjs")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = false,
            WorkingDirectory = root
        };
        psi.EnvironmentVariables["NODE_ENV"] = "production";

        using (var p = new Process())
        {
            p.StartInfo = psi;
            p.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
        }
    }
}
