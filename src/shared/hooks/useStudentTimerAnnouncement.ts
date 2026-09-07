import { useEffect, useRef, useState } from "react";

function formatAnnouncementTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// T2.5: single shared time-warning announcer for every live exam timer
// surface (IELTS full/compact headers, SAT top bar). Polite
// announcements fire ONLY at the 5-minute and 1-minute thresholds, never
// per-second. Each threshold fires once; state resets when time moves back
// above 5 minutes (section change, extension) so the next section announces
// again. Pure React + local formatting only: safe for src/shared (imports no
// app/features/services code, touches no browser globals).
export function useStudentTimerAnnouncement(timeRemaining: number | undefined): string {
  const announcedThresholdRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (timeRemaining === undefined) return;
    if (timeRemaining >= 300) {
      announcedThresholdRef.current = null;
      return;
    }
    const threshold = timeRemaining < 60 ? 60 : 300;
    if (announcedThresholdRef.current === threshold) return;
    announcedThresholdRef.current = threshold;
    setAnnouncement(
      threshold === 60
        ? `Low time: 1 minute remaining (${formatAnnouncementTime(timeRemaining)} left)`
        : `Low time: 5 minutes remaining (${formatAnnouncementTime(timeRemaining)} left)`
    );
  }, [timeRemaining]);

  return announcement;
}
