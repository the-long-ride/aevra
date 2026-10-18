import type { ConnectorNote, ConnectorNoteInput } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import {
  createConnectorNote,
  deleteConnectorNote,
  fetchConnectorNotes,
  updateConnectorNote,
} from '../../services/connector-notes-service';
import { DetailIcon } from '../workspaces/WorkspaceIcons';
import { ConnectionNoteEditor } from './ConnectionNoteEditor';
import { notePreview } from './note-images';

const HIDDEN_HINT = "Hidden notes can't be read or deleted by AI";
const HIDDEN_READ_HINT = "Hidden notes can't be read by AI";
const READ_HINT =
  'Notes are read only when you mention them, except notes with Read on connect on.';
const EMPTY_TEXT = 'No notes yet. Notes are messages for the AI agent using this connector.';

type Editing = { note: ConnectorNote | null } | null;
type NoteSwitch = 'visibleToAi' | 'aiCanDelete' | 'readOnConnect';

export function ConnectionNotesPanel({
  actor,
  onCountChange,
}: {
  actor: string;
  onCountChange?(count: number): void;
}) {
  const dialog = useDialog();
  const { toast, success, error } = useToast();
  const [notes, setNotes] = useState<ConnectorNote[]>();
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  // Optimistic value per in-flight switch, keyed by '<note id>:<field>'.
  const [inflight, setInflight] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    setNotes(undefined);
    setEditing(null);
    fetchConnectorNotes(actor)
      .then((loaded) => {
        if (!live) return;
        setNotes(loaded.notes);
        setLoadError('');
      })
      .catch((cause: unknown) => {
        if (live) setLoadError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [actor]);

  useEffect(() => {
    if (notes) onCountChange?.(notes.length);
  }, [notes, onCountChange]);

  const replace = (next: ConnectorNote) =>
    setNotes((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)));

  const patch = async (note: ConnectorNote, field: NoteSwitch, value: boolean) => {
    const key = `${note.id}:${field}`;
    setInflight((current) => ({ ...current, [key]: value }));
    try {
      replace(await updateConnectorNote(actor, note.id, { [field]: value }));
    } catch (cause) {
      error(cause);
    } finally {
      setInflight((current) => {
        const { [key]: _done, ...rest } = current;
        return rest;
      });
    }
  };

  const isPending = (note: ConnectorNote, field: NoteSwitch) => `${note.id}:${field}` in inflight;

  const shown = (note: ConnectorNote, field: NoteSwitch) =>
    inflight[`${note.id}:${field}`] ?? note[field];

  const save = async (input: ConnectorNoteInput) => {
    const target = editing?.note;
    try {
      if (target) {
        replace(await updateConnectorNote(actor, target.id, input));
      } else {
        const created = await createConnectorNote(actor, input);
        setNotes((current) => [created, ...(current ?? [])]);
      }
      setEditing(null);
      success(target ? 'Note saved.' : 'Note created.');
    } catch (cause) {
      error(cause);
    }
  };

  const remove = async (note: ConnectorNote) => {
    const confirmed = await dialog.confirm({
      title: 'Delete note?',
      message: `Permanently delete "${note.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteConnectorNote(actor, note.id);
      setNotes((current) => (current ?? []).filter((item) => item.id !== note.id));
      success('Note deleted.');
    } catch (cause) {
      error(cause);
    }
  };

  const columns: Column<ConnectorNote>[] = [
    { key: 'title', label: 'Title' },
    {
      key: 'text',
      label: 'Content',
      sortable: false,
      render: (note) => (
        <span className="note-content">
          <span>{notePreview(note.text)}</span>
          {note.images.length ? <span className="muted">{note.images.length} image(s)</span> : null}
        </span>
      ),
    },
    {
      key: 'visibleToAi',
      label: 'Visible to AI',
      search: false,
      render: (note) => (
        <Switch
          label={<span className="sr-only">Visible to AI</span>}
          aria-label={`Visible to AI: ${note.title}`}
          data-surface-id="connections:note-visible"
          checked={shown(note, 'visibleToAi')}
          disabled={isPending(note, 'visibleToAi')}
          onChange={(event) => void patch(note, 'visibleToAi', event.currentTarget.checked)}
        />
      ),
    },
    {
      key: 'aiCanDelete',
      label: 'AI can delete',
      search: false,
      render: (note) => (
        <span title={shown(note, 'visibleToAi') ? undefined : HIDDEN_HINT}>
          <Switch
            label={<span className="sr-only">AI can delete</span>}
            aria-label={`AI can delete: ${note.title}`}
            data-surface-id="connections:note-ai-delete"
            checked={shown(note, 'aiCanDelete')}
            disabled={!shown(note, 'visibleToAi') || isPending(note, 'aiCanDelete')}
            onChange={(event) => void patch(note, 'aiCanDelete', event.currentTarget.checked)}
          />
        </span>
      ),
    },
    {
      key: 'readOnConnect',
      label: 'Read on connect',
      search: false,
      render: (note) => (
        <span title={shown(note, 'visibleToAi') ? undefined : HIDDEN_READ_HINT}>
          <Switch
            label={<span className="sr-only">Read on connect</span>}
            aria-label={`Read on connect: ${note.title}`}
            data-surface-id="connections:note-read-on-connect"
            checked={shown(note, 'readOnConnect')}
            disabled={!shown(note, 'visibleToAi') || isPending(note, 'readOnConnect')}
            onChange={(event) => void patch(note, 'readOnConnect', event.currentTarget.checked)}
          />
        </span>
      ),
    },
    { key: 'updatedAt', label: 'Updated', dateTime: true, search: false },
    {
      key: 'actions',
      label: '',
      sortable: false,
      search: false,
      render: (note) => (
        <div className="actions workspace-row-actions">
          <button
            type="button"
            aria-label={`Edit ${note.title}`}
            title="Edit"
            data-surface-id="connections:note-edit"
            onClick={() => setEditing({ note })}
          >
            <DetailIcon />
          </button>
          <button
            type="button"
            className="danger-button"
            aria-label={`Delete ${note.title}`}
            title="Delete"
            data-surface-id="connections:note-delete"
            onClick={() => void remove(note)}
          >
            [x]
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="connection-notes">
      <div className="connection-notes-bar">
        <p className="muted connection-notes-hint">{READ_HINT}</p>
        <button
          type="button"
          className="primary"
          data-surface-id="connections:note-new"
          disabled={notes === undefined || editing !== null}
          onClick={() => setEditing({ note: null })}
        >
          New note
        </button>
      </div>
      {loadError ? (
        <p role="alert" className="warning">
          {loadError}
        </p>
      ) : null}
      {editing ? (
        <ConnectionNoteEditor
          key={editing.note?.id ?? 'new'}
          actor={actor}
          note={editing.note}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {notes ? (
        <DataTable
          id="connection-notes"
          rows={notes}
          columns={columns}
          rowKey={(note) => note.id}
          defaultSort={{ key: 'updatedAt', direction: 'desc' }}
          pageSize={10}
          paginationPosition="toolbar"
          density="compact"
          searchPlaceholder={'Search notes…'}
          emptyText={EMPTY_TEXT}
        />
      ) : loadError ? null : (
        <p className="muted">{'Loading notes…'}</p>
      )}
      {toast}
    </div>
  );
}
