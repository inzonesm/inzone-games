'use client';

import type { HubGame } from '@/lib/types';
import { IX_COPY, type ExperienceScene } from '@/lib/experience-reset';

const SCENES: { id: ExperienceScene; label: string }[] = [
  { id: 'home', label: 'New visitor' },
  { id: 'play', label: 'Direct play' },
  { id: 'invite-preview', label: 'Invite preview' },
  { id: 'load-fail', label: 'Load failure' },
  { id: 'expired', label: 'Expired invite' },
  { id: 'return', label: 'Return' },
];

export function ExperienceReviewBar({
  scene,
  feature,
  onScene,
  onInjectSuggestion,
  canInject,
}: {
  scene: ExperienceScene;
  feature: HubGame | null;
  onScene: (scene: ExperienceScene, gameId?: string) => void;
  onInjectSuggestion: () => void;
  canInject: boolean;
}) {
  return (
    <div className="ix-banner">
      <strong>{IX_COPY.banner}</strong>
      <div className="ix-scenes">
        {SCENES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={scene === item.id ? 'is-on' : ''}
            onClick={() => onScene(item.id, feature?.id)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" disabled={!canInject} onClick={onInjectSuggestion}>
          Inject labelled suggestion
        </button>
      </div>
    </div>
  );
}
