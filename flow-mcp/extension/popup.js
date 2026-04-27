async function load() {
  const { connected, lastInfo } =
    await chrome.storage.local.get(["connected", "lastInfo"]);
  const s = document.getElementById("status");
  s.textContent = connected
    ? `connected (${lastInfo || "ok"})`
    : `disconnected (${lastInfo || "not connected yet"})`;
  s.className = "status " + (connected ? "ok" : "bad");
}

document.getElementById("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "reconnect" });
  setTimeout(load, 600);
});

load();
setInterval(load, 1500);
