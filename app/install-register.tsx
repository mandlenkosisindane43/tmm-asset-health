"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function InstallRegister() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  if (!prompt) return null;
  return <button className="installapp" onClick={async()=>{await prompt.prompt();await prompt.userChoice;setPrompt(null)}}>↓ Install TMM Asset Health</button>;
}
