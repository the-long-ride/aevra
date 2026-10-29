import { useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { Dropdown } from '../../components/Dropdown';
import { SearchableMultiSelect, type SearchOption } from '../../components/SearchableMultiSelect';
import type { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { buildActorOptions } from '../permissions/permissions-helpers';
import {
  ADMISSION_MODE_OPTIONS,
  ADMISSION_PROFILE_OPTIONS,
  type WorkspaceAdmission,
} from './workspace-options';

type Toasts = ReturnType<typeof useToast>;

export function WorkspaceAdmissionsSection({
  workspaceId,
  success,
  error,
}: {
  workspaceId: string;
  success: Toasts['success'];
  error: Toasts['error'];
}) {
  const dialog = useDialog();
  const [selectedActors, setSelectedActors] = useState<string[]>([]);
  const [actorOptions, setActorOptions] = useState<SearchOption[]>([]);
  const [admissions, setAdmissions] = useState<WorkspaceAdmission[]>([]);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    let active = true;
    Promise.all([
      requestJson<Array<{ id?: string; name?: string }>>('/api/connectors').catch(() => []),
      requestJson<Array<{ id?: string; client?: string; actor?: string }>>(
        '/api/connections',
      ).catch(() => []),
      requestJson<Array<{ id?: string; actor?: string }>>('/api/sessions').catch(() => []),
    ]).then(([connectors, connections, sessions]) => {
      if (active) {
        setActorOptions(buildActorOptions(connectors, connections, sessions as any));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshAdmissions = async () => {
    try {
      const data = await requestJson<WorkspaceAdmission[]>(`${base}/admissions`);
      setAdmissions(Array.isArray(data) ? data : []);
    } catch {
      setAdmissions([]);
    }
  };

  useEffect(() => {
    void refreshAdmissions();
  }, [workspaceId]);

  const updateActorAdmission = async (
    actor: string,
    profileId: string,
    admission: 'auto' | 'ask',
  ) => {
    try {
      await requestJson(`${base}/admission`, {
        method: 'POST',
        body: JSON.stringify({ actor, profileId, admission }),
      });
      success(`Admission updated for "${actor}".`);
      await refreshAdmissions();
    } catch (cause) {
      error(cause);
    }
  };

  const revokeAdmission = async (actor: string) => {
    if (
      !(await dialog.confirm({
        title: 'Remove actor admission',
        message: `Remove admission for "${actor}" from this workspace?`,
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await requestJson(`${base}/admission/${encodeURIComponent(actor)}`, {
        method: 'DELETE',
      });
      success(`Admission removed for "${actor}".`);
      await refreshAdmissions();
    } catch (cause) {
      error(cause);
    }
  };

  const saveAdmission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawFormActor = String(formData.get('actor') ?? '').trim();
    const actorInputEl =
      event.currentTarget.querySelector<HTMLInputElement>('#admission-actor-input');
    const typedQuery = actorInputEl?.value?.trim() ?? '';
    const profileId = String(formData.get('profileId') ?? 'developer');
    const admission = formData.get('admission') === 'ask' ? 'ask' : 'auto';

    const rawActorString = selectedActors.length > 0 ? '' : rawFormActor || typedQuery;
    const actorsToSave =
      selectedActors.length > 0
        ? selectedActors
        : rawActorString
          ? rawActorString
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

    if (actorsToSave.length === 0) return;

    try {
      for (const actor of actorsToSave) {
        await requestJson(`${base}/admission`, {
          method: 'POST',
          body: JSON.stringify({ actor, profileId, admission }),
        });
      }
      setSelectedActors([]);
      if (actorInputEl) actorInputEl.value = '';
      success('Admission policy saved.');
      await refreshAdmissions();
    } catch (cause) {
      error(cause);
    }
  };

  return (
    <section className="form-section">
      <h3>Actor admission</h3>
      <DataTable
        id="react-workspace-admissions"
        rows={admissions}
        columns={[
          {
            key: 'actor',
            label: 'Actor',
            value: (row) => row.actor,
          },
          {
            key: 'profileId',
            label: 'Profile',
            render: (row) => (
              <Dropdown
                className="admission-profile-dropdown"
                ariaLabel={`Profile for ${row.actor}`}
                value={row.profileId}
                onChange={(val) => void updateActorAdmission(row.actor, val, row.admission)}
                options={ADMISSION_PROFILE_OPTIONS}
              />
            ),
          },
          {
            key: 'admission',
            label: 'Admission',
            render: (row) => (
              <Dropdown
                className="admission-mode-dropdown"
                ariaLabel={`Admission policy for ${row.actor}`}
                value={row.admission}
                onChange={(val) =>
                  void updateActorAdmission(row.actor, row.profileId, val as 'auto' | 'ask')
                }
                options={ADMISSION_MODE_OPTIONS}
              />
            ),
          },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <button
                type="button"
                className="danger-button"
                aria-label="Remove"
                title="Remove"
                data-surface-id="workspaces:revoke-admission"
                onClick={() => void revokeAdmission(row.actor)}
              >
                [x]
              </button>
            ),
          },
        ]}
        rowKey={(row) => row.actor}
        emptyText="No admitted actors."
      />
      <form className="form-row" onSubmit={saveAdmission}>
        <div className="field">
          <label htmlFor="admission-actor-input">Actor</label>
          <SearchableMultiSelect
            id="admission-actor-input"
            name="actor"
            placeholder="Search connector or enter actor (e.g. connector:ChatGPT)…"
            options={actorOptions}
            values={selectedActors}
            onChange={setSelectedActors}
          />
        </div>
        <label className="field">
          <span>Profile</span>
          <Dropdown
            name="profileId"
            ariaLabel="Profile"
            defaultValue="developer"
            options={ADMISSION_PROFILE_OPTIONS}
          />
        </label>
        <label className="field">
          <span>Admission</span>
          <Dropdown
            name="admission"
            ariaLabel="Admission"
            defaultValue="auto"
            options={ADMISSION_MODE_OPTIONS}
          />
        </label>
        <button className="primary" data-surface-id="workspaces:save-admission">
          Save admission
        </button>
      </form>
    </section>
  );
}
