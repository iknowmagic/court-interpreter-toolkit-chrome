import React, { useMemo, useState } from "react";
import type { Story } from "@ladle/react";

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	if (sharedAudioContext) return sharedAudioContext;

	const WindowWithWebkit = window as Window & {
		webkitAudioContext?: typeof AudioContext;
	};
	const ContextCtor = WindowWithWebkit.AudioContext || WindowWithWebkit.webkitAudioContext;
	if (!ContextCtor) return null;
	sharedAudioContext = new ContextCtor();
	return sharedAudioContext;
}

function envelope(
	gainNode: GainNode,
	startTime: number,
	peak: number,
	attackSeconds: number,
	releaseSeconds: number,
): void {
	gainNode.gain.setValueAtTime(0.0001, startTime);
	gainNode.gain.exponentialRampToValueAtTime(peak, startTime + attackSeconds);
	gainNode.gain.exponentialRampToValueAtTime(
		0.0001,
		startTime + attackSeconds + releaseSeconds,
	);
}

async function playSmoothCompletionAlarm(): Promise<void> {
	const audioContext = getAudioContext();
	if (!audioContext) return;

	if (audioContext.state === "suspended") {
		await audioContext.resume();
	}

	const now = audioContext.currentTime;
	const frequencies = [523.25, 659.25, 783.99];
	const spacingSeconds = 0.2;
	const durationSeconds = 0.32;

	frequencies.forEach((frequency, index) => {
		const startTime = now + index * spacingSeconds;
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();

		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(frequency, startTime);
		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		envelope(
			gainNode,
			startTime,
			0.16,
			0.03,
			Math.max(0.12, durationSeconds - 0.03),
		);

		oscillator.start(startTime);
		oscillator.stop(startTime + durationSeconds);
	});
}

export default {
	title: "Audio/Completion Alarm",
};

export const Preview: Story = () => {
	const [status, setStatus] = useState<"idle" | "played" | "unsupported">("idle");

	const statusText = useMemo(() => {
		if (status === "played") return "Played. Click again to replay.";
		if (status === "unsupported") return "Web Audio API is not available in this browser.";
		return "Click play to hear the alarm.";
	}, [status]);

	const handlePlay = async (): Promise<void> => {
		try {
			await playSmoothCompletionAlarm();
			setStatus(getAudioContext() ? "played" : "unsupported");
		} catch {
			setStatus("unsupported");
		}
	};

	return (
		<div
			style={{
				padding: "24px",
				fontFamily: "system-ui, sans-serif",
				display: "grid",
				gap: "12px",
				maxWidth: "420px",
			}}
		>
			<h2 style={{ margin: 0, fontSize: "20px" }}>Completion Alarm</h2>
			<p style={{ margin: 0, color: "#4b5563" }}>
				Same smooth three-tone chime used for task completion.
			</p>
			<button
				onClick={() => {
					void handlePlay();
				}}
				style={{
					width: "fit-content",
					padding: "8px 14px",
					borderRadius: "8px",
					border: "1px solid #0891b2",
					backgroundColor: "#06b6d4",
					color: "#ffffff",
					fontWeight: 600,
					cursor: "pointer",
				}}
			>
				Play alarm
			</button>
			<p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>{statusText}</p>
		</div>
	);
};
