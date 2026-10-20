def classFactory(iface):
    from .archeodoc import ArcheoDocCheckerPlugin

    return ArcheoDocCheckerPlugin(iface)
