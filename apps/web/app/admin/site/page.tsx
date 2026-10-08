import { redirect } from 'next/navigation';

// The old "Domain" page (address and custom domain) is gone; /admin/site lands on Appearance.
export default function SitePage() {
  redirect('/admin/site/appearance');
}
