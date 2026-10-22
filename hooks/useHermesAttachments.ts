"use client";

import { useEffect, useRef, useState } from "react";
import { dropMentionText, splitDroppedItems, uploadFiles, type DroppedItem } from "@/lib/file-upload-client";

export function useHermesAttachments(options: {
  cwd: string | null; draftKey: string; blocked: boolean;
  onImages: (files: File[]) => void; onMention: (text: string) => void;
  onUploaded: () => void; onBusyChange: (busy: boolean) => void;
  selectDirectory: (path: string) => Promise<void>;
}) {
  const latest = useRef(options); latest.current = options;
  const controllerRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [foldersSkipped, setFoldersSkipped] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setPending([]); setNotice(""); setError(""); setFoldersSkipped(false); setPickerOpen(false);
    return () => { controllerRef.current?.abort(); latest.current.onBusyChange(false); };
  }, [options.draftKey]);

  async function upload(files: File[], cwd: string) {
    if (controllerRef.current) return;
    const owner = latest.current.draftKey;
    const controller = new AbortController(); controllerRef.current = controller;
    setPending(files); setBusy(true); setProgress(0); setError(""); setNotice("");
    latest.current.onBusyChange(true);
    try {
      const { status, data } = await uploadFiles(cwd, files, "skip", setProgress, controller.signal);
      if (controller.signal.aborted || owner !== latest.current.draftKey) return;
      if (status !== 200 && status !== 207) throw new Error(data.error || `HTTP ${status}`);
      const present = [...(data.uploaded ?? []), ...(data.skipped ?? [])];
      const failed = files.filter(file => !present.includes(file.name));
      const mentions = dropMentionText(files, present);
      if (mentions) latest.current.onMention(mentions);
      if (data.uploaded?.length) latest.current.onUploaded();
      setPending(failed);
      setNotice(data.skipped?.length ? "同名文件已保留，已引用现有文件。" : present.length ? "附件已上传并添加到输入框。" : "");
      if (failed.length) setError("部分附件上传失败，文件已保留，请重试。");
    } catch {
      if (!controller.signal.aborted && owner === latest.current.draftKey) setError("附件上传失败，文件已保留，请重试。");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null; latest.current.onBusyChange(false); setBusy(false);
      }
    }
  }
  function attach(items: DroppedItem[]) {
    if (latest.current.blocked || controllerRef.current) { setError("请等待当前操作完成后再添加附件。"); return; }
    const { images, files, folders } = splitDroppedItems(items);
    setError(""); setNotice("");
    if (images.length) latest.current.onImages(images);
    setFoldersSkipped(folders.length > 0);
    if (files.length) {
      const batch = [...new Map([...pending, ...files].map(file => [file.name, file])).values()];
      setPending(batch);
      if (!latest.current.cwd) setPickerOpen(true);
      else void upload(batch, latest.current.cwd);
    }
  }
  async function selectDirectory(path: string) {
    if (picking) return;
    setPicking(true); setError("");
    try {
      await latest.current.selectDirectory(path);
      setPickerOpen(false);
      await upload(pending, path);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "项目目录无法使用，请重新选择。"); }
    finally { setPicking(false); }
  }
  return {
    attach, busy, progress, pending, notice, error, foldersSkipped, pickerOpen, picking, selectDirectory,
    retry: () => {
      if (!pending.length || latest.current.blocked) return;
      if (!latest.current.cwd) setPickerOpen(true);
      else void upload(pending, latest.current.cwd);
    },
    cancelPicker: () => { if (!picking) setPickerOpen(false); },
    dismiss: () => { if (!busy) { setPending([]);setNotice("");setError("");setFoldersSkipped(false); } },
  };
}
