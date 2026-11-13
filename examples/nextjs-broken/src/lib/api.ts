'use client';

// DRC002: Hardcoded localhost API URL in client component
export async function fetchOrders() {
  const res = await fetch('http://localhost:3000/api/orders');
  return res.json();
}
