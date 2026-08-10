import { useEffect, useState } from "react";

export function App() {
  const [status, setStatus] = useState("loading...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { version: string }) => setStatus(`server v${data.version}`))
      .catch(() => setStatus("offline"));
  }, []);

  return (
    <div>
      <h1>ccockpit</h1>
      <p>{status}</p>
    </div>
  );
}
