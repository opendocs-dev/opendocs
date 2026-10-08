import { getPlatformAiModels, getPlatformMe } from '@/lib/server-api';
import { ModelsManager } from './models-manager';

export const metadata = { title: 'AI models and providers — OpenDocs' };

export default async function PlatformAiModelsPage() {
  const [{ models, providers, forbidden }, { staff }] = await Promise.all([
    getPlatformAiModels(),
    getPlatformMe(),
  ]);

  if (forbidden || !staff) {
    return (
      <div className="stack">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </div>
    );
  }

  return (
    <ModelsManager
      initialModels={models}
      initialProviders={providers}
      currentRole={staff.role}
    />
  );
}
