let nativeFiles: NativeFiles | undefined;
export const isNativeApp = () => !!nativeFiles;

export function configureNativeExports(files: NativeFiles) {
  nativeFiles = files;
}

export interface ExportFile {
  name: string;
  content: string;
  mimeType: string;
  base64?: boolean;
}

export interface NativeFiles {
  write(file: ExportFile, path: string): Promise<string>;
  share(uri: string): Promise<void>;
}

// Keep the filename separate from directories, including for restored entries.
export function reportPath(name: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(name) || name.includes(".."))
    throw new Error("Invalid export filename.");
  if (!/^[a-zA-Z0-9-]+$/.test(id))
    throw new Error("Invalid export identifier.");
  const dot = name.lastIndexOf(".");
  if (dot < 1 || dot === name.length - 1)
    throw new Error("Missing export file type.");
  return `Reports/${name.slice(0, dot)}-${id}${name.slice(dot)}`;
}

export async function saveNativeExport(
  file: ExportFile,
  files: NativeFiles,
  id = crypto.randomUUID(),
): Promise<string> {
  const uri = await files.write(file, reportPath(file.name, id));
  // Cancelling the share sheet leaves the saved report available in Files.
  try {
    await files.share(uri);
  } catch {
    return "Saved in Files → iHurt → Reports. You can share it from there.";
  }
  return "Saved in Files → iHurt → Reports.";
}

export async function saveExport(file: ExportFile): Promise<string> {
  if (nativeFiles) return saveNativeExport(file, nativeFiles);
  const data = file.base64
    ? Uint8Array.from(atob(file.content), (character) =>
        character.charCodeAt(0),
      )
    : file.content;
  const url = URL.createObjectURL(new Blob([data], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "Download started.";
}
