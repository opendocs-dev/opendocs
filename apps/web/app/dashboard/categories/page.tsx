import Link from 'next/link';
import { getAdminCategories, getSite, getMe } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { CategoriesManager } from './categories-manager';

export const metadata = { title: 'Categories — OpenDocs' };

export default async function CategoriesPage() {
  const [categories, site, me] = await Promise.all([
    getAdminCategories(),
    getSite(),
    getMe(),
  ]);

  const canEditPolicy = me && (normalizeRole(me.role) === 'owner' || normalizeRole(me.role) === 'admin');

  if (!categories) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Categories</h1>
            <div className="sub">Group guides on your site and in search</div>
          </div>
        </div>
        <p role="alert">
          Could not load your categories.{' '}
          <Link href="/dashboard/categories">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <CategoriesManager
      categories={categories.categories}
      policy={site?.category_policy || 'suggest'}
      canEditPolicy={canEditPolicy || false}
    />
  );
}
