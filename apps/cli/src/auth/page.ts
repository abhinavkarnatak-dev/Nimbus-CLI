const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Page shown in the browser tab when login finishes
export function resultPage(ok: boolean, message: string): string {
  const title = ok ? "You're in" : "Login failed";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Nimbus</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0c; color: #e8e8e8; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 420px; padding: 32px; border: 1px solid #2a2a2e; border-radius: 14px; }
  h1 { margin: 0 0 8px; font-size: 20px; color: ${ok ? "#f5c542" : "#e5737a"}; }
  p { margin: 0; color: #a1a1a8; }
</style>
</head>
<body><main><h1>◆ ${title}</h1><p>${escape(message)}</p></main></body>
</html>`;
}
