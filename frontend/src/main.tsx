import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

const shouldRegisterServiceWorker =
	"serviceWorker" in navigator &&
	import.meta.env.PROD &&
	import.meta.env.VITE_ENABLE_PWA !== "false";

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		if (shouldRegisterServiceWorker) {
			void navigator.serviceWorker.register("/sw.js");
			return;
		}

		void navigator.serviceWorker.getRegistrations().then((registrations) => {
			for (const registration of registrations) {
				void registration.unregister();
			}
		});
	});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
