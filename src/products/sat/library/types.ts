export interface LibraryFolder {
  id: string;
  scopeKey: string;
  providerKey: string;
  organizationId?: string | undefined;
  parentId?: string | undefined;
  name: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryEntry {
  examId: string;
  folderId?: string | undefined;
  revision: number;
}

export interface ExamLibrary {
  folders: LibraryFolder[];
  entries: LibraryFolderEntryMap;
}

export type LibraryFolderEntryMap = Record<string, LibraryEntry>;

export function entryMap(entries: LibraryEntry[]): LibraryFolderEntryMap {
  const map: LibraryFolderEntryMap = {};
  for (const entry of entries) map[entry.examId] = entry;
  return map;
}

export function folderIdOf(entries: LibraryFolderEntryMap, examId: string): string | null {
  return entries[examId]?.folderId ?? null;
}

export function childrenOf(folders: LibraryFolder[], parentId: string | null): LibraryFolder[] {
  return folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

export function ancestorsOf(folders: LibraryFolder[], folderId: string): LibraryFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: LibraryFolder[] = [];
  let current = byId.get(folderId);
  let guard = 0;
  while (current && guard < 40) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }
  return chain;
}

export function descendantIds(folders: LibraryFolder[], folderId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentId ?? "";
    const list = kids.get(parent) ?? [];
    list.push(folder.id);
    kids.set(parent, list);
  }
  const out = new Set<string>();
  const stack = [...(kids.get(folderId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (out.has(next)) continue;
    out.add(next);
    for (const child of kids.get(next) ?? []) stack.push(child);
  }
  return out;
}
