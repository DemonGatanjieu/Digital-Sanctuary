import { useEffect, useState } from "react";
import type { AnalysisTaskSummary, ImageTaskSummary } from "@sanctuary/domain";

export function useAnalysisTasks(open: boolean) {
  const [jobs, setJobs] = useState<AnalysisTaskSummary[]>([]);
  const [images, setImages] = useState<ImageTaskSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const [next, imageTasks] = await Promise.all([window.sanctuary.listAnalysisTaskSummaries(), window.sanctuary.listImageTaskSummaries()]);
        if (active) { setJobs((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);setImages(current=>JSON.stringify(current)===JSON.stringify(imageTasks)?current:imageTasks); setError(""); }
      } catch { if (active) setError("读取任务失败，可重新读取或到整理台查看"); }
      finally {
        if (active) { setLoading(false); timer = window.setTimeout(() => void poll(), open ? 1500 : 5000); }
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [open, revision]);
  return { jobs, images, error, loading, refresh: () => setRevision((value) => value + 1) };
}
