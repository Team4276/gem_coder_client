param(
    [switch]$Check,
    [switch]$PickFile,
    [string]$Title = "Choose your project folder",
    [string]$OkLabel = "Choose folder",
    [string]$FileName = ""
)

$source = @'
using System;
using System.Runtime.InteropServices;

namespace GemCoder {
    [Flags]
    internal enum FileOpenDialogOptions : uint {
        PickFolders = 0x00000020,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800,
        FileMustExist = 0x00001000
    }

    internal enum ShellDisplayName : uint {
        FileSystemPath = 0x80058000
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem {
        void BindToHandler(IntPtr bindContext, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem parent);
        void GetDisplayName(ShellDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, IntPtr filterSpec);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileOpenDialogOptions options);
        void GetOptions(out FileOpenDialogOptions options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, int placement);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialog { }

    public static class FolderPicker {
        private static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

        public static string Pick(string title, string okLabel, bool pickFile, string fileName) {
            try { SetProcessDpiAwarenessContext(PerMonitorAwareV2); } catch (EntryPointNotFoundException) { }
            IntPtr previous = IntPtr.Zero;
            try {
                previous = SetThreadDpiAwarenessContext(PerMonitorAwareV2);
                IFileDialog dialog = (IFileDialog)new FileOpenDialog();
                FileOpenDialogOptions options = FileOpenDialogOptions.ForceFileSystem | FileOpenDialogOptions.PathMustExist;
                options |= pickFile ? FileOpenDialogOptions.FileMustExist : FileOpenDialogOptions.PickFolders;
                dialog.SetOptions(options);
                dialog.SetTitle(title);
                dialog.SetOkButtonLabel(okLabel);
                if (pickFile && !String.IsNullOrWhiteSpace(fileName)) dialog.SetFileName(fileName);
                if (dialog.Show(IntPtr.Zero) != 0) return String.Empty;
                IShellItem item;
                dialog.GetResult(out item);
                IntPtr fileSystemPath;
                item.GetDisplayName(ShellDisplayName.FileSystemPath, out fileSystemPath);
                try { return Marshal.PtrToStringUni(fileSystemPath) ?? String.Empty; }
                finally { Marshal.FreeCoTaskMem(fileSystemPath); }
            } finally {
                if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
            }
        }
    }
}
'@

Add-Type -TypeDefinition $source -ErrorAction Stop
if (-not $Check) {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::Write([GemCoder.FolderPicker]::Pick($Title, $OkLabel, $PickFile.IsPresent, $FileName))
}
