// DRC007: Unprefixed API_URL in Vite client component (needs VITE_API_URL)
const apiBase = process.env.API_URL;

export async function loadDashboard() {
  const response = await fetch(`${apiBase}/api/dashboard`);
  return response.json();
}
