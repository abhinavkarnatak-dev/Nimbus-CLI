const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Small page for the browser tab
export function messagePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} - Nimbus</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0c; color: #e8e8e8; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 420px; padding: 32px; border: 1px solid #2a2a2e; border-radius: 14px; }
  h1 { margin: 0 0 8px; font-size: 20px; color: #f5c542; }
  p { margin: 0; color: #a1a1a8; }
</style>
</head>
<body><main><h1>${escape(title)}</h1><p>${escape(body)}</p></main></body>
</html>`;
}
