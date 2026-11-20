import type { ConversationLanguage } from '../types';
import { useConversationSettings } from './useConversationSettings';

/** The Settings checkbox that keeps every lecture control visible. Shared by every Settings window. */
export function LectureControlsSetting({ initialLanguage }: { initialLanguage?: ConversationLanguage }) {
  const [settings, setSettings] = useConversationSettings(initialLanguage);
  return (
    <label className="flex items-start gap-3 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-[#5843A5]"
        checked={settings.alwaysShowAllLectureControls}
        onChange={(event) => {
          const always = event.target.checked;
          setSettings((current) => ({ ...current, alwaysShowAllLectureControls: always }));
        }}
      />
      <span>
        <span className="font-semibold">Always show all lecture controls</span>
        <span className="block text-xs opacity-75">
          Lecture mode opens with every control visible and hides the simple-controls button.
        </span>
      </span>
    </label>
  );
}
