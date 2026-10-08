import Link from 'next/link';

export default function TenantNotFound() {
  return (
    <main className="page tenant-content">
      <section className="tenant-empty">
        <p>Page not found</p>
        <p>
          <Link href="/">Back home</Link>
        </p>
      </section>
    </main>
  );
}
