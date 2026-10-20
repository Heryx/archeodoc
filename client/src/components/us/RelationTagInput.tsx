import { useRef, useState, useCallback } from "react";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type RelationTagInputProps = {
  value: string; // comma-separated string
  onChange: (val: string) => void;
  suggestions?: string[]; // available US codes
  placeholder?: string;
  onNavigate?: (code: string) => void;
};

/** Parses a comma/semicolon/pipe-separated string into an array of trimmed tokens */
function parseTokens(raw: string): string[] {
  return raw
    .split(/[,;|\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Serializes tokens back to a comma-separated string */
function serializeTokens(tokens: string[]): string {
  return tokens.join(", ");
}

export function RelationTagInput({ value, onChange, suggestions = [], placeholder, onNavigate }: RelationTagInputProps) {
  const tags = parseTokens(value);
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = suggestions.filter((s) => {
    const q = inputValue.trim().toUpperCase();
    if (!q) return false;
    return (
      s.toUpperCase().includes(q) &&
      !tags.some((t) => t.toUpperCase() === s.toUpperCase())
    );
  });

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.toUpperCase() === trimmed.toUpperCase())) return;
    onChange(serializeTokens([...tags, trimmed]));
    setInputValue("");
    setOpen(false);
  }

  function removeTag(index: number) {
    const next = tags.filter((_, i) => i !== index);
    onChange(serializeTokens(next));
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === "," || e.key === ";") {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
        removeTag(tags.length - 1);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputValue, tags],
  );

  return (
    <div className="relative">
      <div
        className={cn(
          "flex flex-wrap gap-1 min-h-9 rounded-md border border-input bg-background px-2 py-1.5 text-sm",
          "focus-within:ring-1 focus-within:ring-ring cursor-text",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-mono"
          >
            {onNavigate ? (
              <button
                type="button"
                className="hover:underline focus:outline-none flex items-center gap-0.5"
                title={`Apri ${tag}`}
                onClick={(e) => { e.stopPropagation(); onNavigate(tag); }}
                tabIndex={-1}
              >
                {tag}
                <ExternalLink size={9} className="opacity-60" />
              </button>
            ) : tag}
            <button
              type="button"
              className="hover:text-destructive focus:outline-none"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              tabIndex={-1}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-20 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
          value={inputValue}
          placeholder={tags.length === 0 ? (placeholder ?? "es. US 001, US 002") : ""}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
      </div>

      {open && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault(); // prevents blur firing before click
                addTag(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
