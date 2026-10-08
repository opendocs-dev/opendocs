import { getAdminCategories, getOverview } from '@/lib/server-api';
import { PromptBuilder } from './prompt-builder';

export const metadata = { title: 'New guide — OpenDocs' };

export default async function NewGuidePage() {
  const [categoriesData, overview] = await Promise.all([
    getAdminCategories(),
    getOverview(),
  ]);
  const categoryNames = categoriesData?.categories.map((cat) => cat.name) || [];
  const hasKey = overview?.has_key ?? false;

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>New guide</h1>
          <div className="sub">Ask your AI agent to record it</div>
        </div>
      </div>

      <PromptBuilder categoryNames={categoryNames} hasKey={hasKey} />
    </div>
  );
}
