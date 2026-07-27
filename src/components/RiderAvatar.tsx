import { useEffect, useState, type CSSProperties } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { prepareRiderPhoto, riderInitials } from '../lib/riderPhotos';

type RiderAvatarProps = {
  name: string;
  photoUrl?: string;
  accent?: string;
  className?: string;
};

type RiderPhotoEditorProps = RiderAvatarProps & {
  disabled?: boolean;
  onPhotoChange: (photoUrl: string | undefined) => void;
};

export function RiderAvatar({
  name,
  photoUrl,
  accent = '#7ade36',
  className = '',
}: RiderAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  return (
    <span
      className={`rider-avatar ${photoUrl && !imageFailed ? 'has-photo' : ''} ${className}`.trim()}
      style={{ '--rider-avatar-accent': accent } as CSSProperties}
      aria-label={`${name} profile picture`}
    >
      {photoUrl && !imageFailed ? (
        <img
          src={photoUrl}
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{riderInitials(name)}</span>
      )}
    </span>
  );
}

export function RiderPhotoEditor({
  name,
  photoUrl,
  accent,
  disabled = false,
  onPhotoChange,
}: RiderPhotoEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  return (
    <div className="rider-photo-editor">
      <RiderAvatar name={name} photoUrl={photoUrl} accent={accent} />
      <div className="rider-photo-actions">
        <label className={disabled || processing ? 'disabled' : ''}>
          <Camera size={14} />
          <span>{processing ? 'Preparing…' : photoUrl ? 'Change photo' : 'Add photo'}</span>
          <input
            type="file"
            accept="image/*"
            disabled={disabled || processing}
            aria-label={`Upload photo for ${name}`}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (!file) {
                return;
              }

              setProcessing(true);
              setMessage(null);
              void prepareRiderPhoto(file)
                .then((nextPhotoUrl) => {
                  onPhotoChange(nextPhotoUrl);
                  setMessage('Photo saved.');
                })
                .catch((error: Error) => setMessage(error.message))
                .finally(() => setProcessing(false));
            }}
          />
        </label>
        {photoUrl && (
          <button
            type="button"
            disabled={disabled || processing}
            aria-label={`Remove photo for ${name}`}
            title="Remove profile photo"
            onClick={() => {
              onPhotoChange(undefined);
              setMessage('Photo removed.');
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {message && (
        <small className={message === 'Photo saved.' || message === 'Photo removed.' ? 'success' : 'error'} role="status">
          {message}
        </small>
      )}
    </div>
  );
}
