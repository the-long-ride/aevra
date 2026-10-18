import type { ConnectorNote, ConnectorNoteImage, ConnectorNoteInput } from '@aevra/admin-contracts';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Switch } from '../../components/Switch';
import { connectorNoteImageUrl } from '../../services/connector-notes-service';
import {
  checkNoteImages,
  NOTE_IMAGE_ACCEPT,
  readNoteImages,
  type PendingImage,
} from './note-images';
import { useFileDrop } from './use-file-drop';

export function ConnectionNoteEditor({
  actor,
  note,
  onSave,
  onCancel,
}: {
  actor: string;
  note: ConnectorNote | null;
  onSave(input: ConnectorNoteInput): Promise<void>;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [text, setText] = useState(note?.text ?? '');
  // New notes: visible on, AI can delete off, read on connect off (server defaults).
  const [visibleToAi, setVisibleToAi] = useState(note?.visibleToAi ?? true);
  const [aiCanDelete, setAiCanDelete] = useState(note?.aiCanDelete ?? false);
  const [readOnConnect, setReadOnConnect] = useState(note?.readOnConnect ?? false);
  const [kept, setKept] = useState<ConnectorNoteImage[]>(note?.images ?? []);
  const [added, setAdded] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const imageCount = kept.length + added.length;
  const empty = text.trim() === '' && imageCount === 0;

  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' });
    titleRef.current?.focus();
  }, []);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const problem = checkNoteImages(files, imageCount);
    if (problem) {
      setImageError(problem);
      return;
    }
    try {
      const read = await readNoteImages(files);
      setImageError('');
      setAdded((current) => [...current, ...read]);
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const { dragging, handlers: dropHandlers } = useFileDrop((files) => void addFiles(files));

  const openPicker = () => fileInputRef.current?.click();
  const onZoneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPicker();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  };

  const save = async () => {
    const input: ConnectorNoteInput = { text };
    // On edit, send only switches changed here: a table toggle made while the editor was
    // open must not be overwritten by the value the editor started with.
    const flags = { visibleToAi, aiCanDelete, readOnConnect };
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
      if (!note || flags[key] !== note[key]) input[key] = flags[key];
    }
    const trimmedTitle = title.trim();
    if (note) {
      // A cleared title on edit asks the server for a fresh note-N.
      input.title = trimmedTitle;
      input.keepImageIds = kept.map((image) => image.id);
    } else if (trimmedTitle) {
      input.title = trimmedTitle;
    }
    if (added.length) {
      input.addImages = added.map((image) => ({ name: image.name, dataBase64: image.dataUrl }));
    }
    setSaving(true);
    try {
      await onSave(input);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      className="note-editor form-section"
      aria-label={note ? 'Edit note' : 'New note'}
      data-dragging={dragging ? 'true' : undefined}
      {...dropHandlers}
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && !empty) void save();
      }}
    >
      {dragging ? (
        <div className="note-drop-overlay" aria-hidden="true">
          Drop images to add
        </div>
      ) : null}
      <h4 className="connection-section-title">{note ? `Edit ${note.title}` : 'New note'}</h4>
      <div className="note-title-row">
        <label className="note-field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            maxLength={80}
            placeholder="note-N (filled automatically)"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <div className="note-title-switches">
          <Switch
            label="Visible to AI"
            containerClassName="note-visible-switch"
            data-surface-id="connections:note-editor-visible"
            checked={visibleToAi}
            onChange={(event) => setVisibleToAi(event.currentTarget.checked)}
          />
          <span title={visibleToAi ? undefined : "Hidden notes can't be read or deleted by AI"}>
            <Switch
              label="AI can delete"
              data-surface-id="connections:note-editor-ai-delete"
              checked={aiCanDelete}
              disabled={!visibleToAi}
              onChange={(event) => setAiCanDelete(event.currentTarget.checked)}
            />
          </span>
          <span title={visibleToAi ? undefined : "Hidden notes can't be read by AI"}>
            <Switch
              label="Read on connect"
              data-surface-id="connections:note-editor-read-on-connect"
              checked={readOnConnect}
              disabled={!visibleToAi}
              onChange={(event) => setReadOnConnect(event.currentTarget.checked)}
            />
          </span>
        </div>
      </div>
      <label className="note-field">
        <span>Text</span>
        <textarea
          value={text}
          rows={6}
          maxLength={20000}
          onChange={(event) => setText(event.currentTarget.value)}
          onPaste={onPaste}
        />
      </label>
      <p className="muted note-images-hint">
        Up to 4 images, 2 MiB each. Drop them anywhere here, or paste into Text.
      </p>
      {imageError ? (
        <p role="alert" className="warning">
          {imageError}
        </p>
      ) : null}
      {imageCount ? (
        <ul className="note-thumbs">
          {kept.map((image) => (
            <li key={image.id}>
              <img src={connectorNoteImageUrl(actor, note!.id, image.id)} alt={image.name} />
              <button
                type="button"
                aria-label={`Remove image ${image.name}`}
                onClick={() => setKept((current) => current.filter((item) => item !== image))}
              >
                {'\u00d7'}
              </button>
            </li>
          ))}
          {added.map((image) => (
            <li key={image.key}>
              <img src={image.dataUrl} alt={image.name} />
              <button
                type="button"
                aria-label={`Remove image ${image.name}`}
                onClick={() => setAdded((current) => current.filter((item) => item !== image))}
              >
                {'\u00d7'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="note-editor-footer">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop images or click to add"
          className="note-dropzone"
          onClick={openPicker}
          onKeyDown={onZoneKey}
        >
          Drop images or click to add
        </div>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          aria-label="Add images"
          accept={NOTE_IMAGE_ACCEPT}
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void addFiles(files);
          }}
        />
        <div className="note-editor-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            data-surface-id="connections:note-save"
            disabled={saving || empty}
          >
            Save note
          </button>
        </div>
      </div>
    </form>
  );
}
