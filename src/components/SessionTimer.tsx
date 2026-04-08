import React from "react";
import { formatDuration } from "@shared/practice";

interface SessionTimerProps {
  remainingMs: number;
  isRunning: boolean;
  totalMs: number;
}

export default function SessionTimer({
  remainingMs,
  isRunning,
  totalMs,
}: SessionTimerProps) {
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progressPercent =
    totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;

  return (
    <div className="text-center">
      {/* Timer Display */}
      <div className="mb-6">
        <div className="text-6xl font-mono font-bold text-gray-800 tracking-wider">
          {formatDuration(remainingSeconds)}
        </div>
        <p
          className={`text-sm mt-2 ${isRunning ? "text-green-600 font-semibold" : "text-gray-600"}`}
        >
          {isRunning ? "⏱ Running" : "⏸ Paused"}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className="bg-cyan-500 h-full transition-all duration-300 ease-linear"
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>
    </div>
  );
}
