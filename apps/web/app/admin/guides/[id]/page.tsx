import { notFound } from 'next/navigation';
import { getGuideById, getAdminCategories, getMe, getGuideSteps, getGuideRuns } from '@/lib/server-api';
import { GuideDetailView } from './guide-detail-view';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guide = await getGuideById(id);
  return { title: guide ? `${guide.title} — OpenDocs` : 'Guide — OpenDocs' };
}

export default async function GuideSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [guide, categories, me, steps, runs] = await Promise.all([
    getGuideById(id),
    getAdminCategories(),
    getMe(),
    getGuideSteps(id),
    getGuideRuns(id),
  ]);

  if (!guide) {
    notFound();
  }

  const previewUrl =
    guide.slug && guide.visibility !== 'draft' 
      ? `/g/${guide.slug}`
      : guide.url;

  return (
    <div className="stack">
      <GuideDetailView
        guide={guide}
        initialSteps={steps || []}
        categories={categories?.categories || []}
        siteName={me?.workspace?.name || null}
        previewUrl={previewUrl}
        initialRuns={runs || []}
      />
    </div>
  );
}
