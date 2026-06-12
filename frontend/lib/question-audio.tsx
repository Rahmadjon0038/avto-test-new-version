import { Volume2 } from "lucide-react";

type QuestionAudioProps = {
  audio?: string;
  className?: string;
};

export function resolveQuestionAudio(audio?: string) {
  const value = String(audio || "").trim();
  if (!value) return "";
  return value;
}

export function QuestionAudio({ audio, className }: QuestionAudioProps) {
  const src = resolveQuestionAudio(audio);
  if (!src) return null;

  return (
    <div className={["questionAudio", className].filter(Boolean).join(" ")}>
      <div className="questionAudioHeader">
        <span className="questionAudioBadge" aria-hidden="true">
          <Volume2 className="lucide" />
        </span>
        <div className="questionAudioTitle">Audio izoh</div>
      </div>
      <div className="questionAudioPlayerWrap">
        <audio className="questionAudioPlayer" controls preload="metadata" src={src} controlsList="nodownload noplaybackrate" />
      </div>
    </div>
  );
}
