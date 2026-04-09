let audioContext = null;

function envelope(gainNode, startTime, peak, attackSeconds, releaseSeconds) {
	gainNode.gain.setValueAtTime(0.0001, startTime);
	gainNode.gain.exponentialRampToValueAtTime(peak, startTime + attackSeconds);
	gainNode.gain.exponentialRampToValueAtTime(
		0.0001,
		startTime + attackSeconds + releaseSeconds,
	);
}

function playTone(frequency, startTime, durationSeconds, outputNode) {
	const oscillator = audioContext.createOscillator();
	const gainNode = audioContext.createGain();

	oscillator.type = "sine";
	oscillator.frequency.setValueAtTime(frequency, startTime);

	oscillator.connect(gainNode);
	gainNode.connect(outputNode);

	envelope(gainNode, startTime, 0.16, 0.03, Math.max(0.12, durationSeconds - 0.03));

	oscillator.start(startTime);
	oscillator.stop(startTime + durationSeconds);
}

function playCompletionAlarm() {
	if (!audioContext) {
		audioContext = new AudioContext();
	}
	if (audioContext.state === "suspended") {
		void audioContext.resume();
	}

	const now = audioContext.currentTime;
	const frequencies = [523.25, 659.25, 783.99];
	const spacingSeconds = 0.2;
	const durationSeconds = 0.32;

	frequencies.forEach((frequency, index) => {
		const startTime = now + index * spacingSeconds;
		playTone(frequency, startTime, durationSeconds, audioContext.destination);
	});
}

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type !== "PLAY_COMPLETION_ALARM" || message?.target !== "offscreen") {
		return;
	}
	playCompletionAlarm();
});
