import Browser from "webextension-polyfill";

Browser.devtools.panels
	.create("Dev Tools", "icon.png", "src/pages/devtools/index.html")
	.catch(console.error);
