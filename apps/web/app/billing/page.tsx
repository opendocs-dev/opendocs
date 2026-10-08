import { notFound, redirect } from 'next/navigation';

export default function BillingRedirect() {
  if (process.env.BILLING_READY !== 'true') {
    notFound();
  }
  redirect('/dashboard/billing');
}
