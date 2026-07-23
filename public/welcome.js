const startButton = document.querySelector("#start-practicing");

let isClosing = false;

async function closeWelcomeTab() {
	if (isClosing) return;
	isClosing = true;

	const tabs = globalThis.chrome?.tabs;

	if (tabs?.getCurrent && tabs?.remove) {
		try {
			const currentTab = await tabs.getCurrent();

			if (typeof currentTab?.id === "number") {
				await tabs.remove(currentTab.id);
				return;
			}
		} catch (error) {
			console.error("Failed to close the welcome tab.", error);
		}
	}

	window.close();
}

startButton?.addEventListener("click", closeWelcomeTab);
