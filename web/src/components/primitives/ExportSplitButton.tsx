/**
 * Phase N3 - ExportSplitButton primitive.
 *
 * Single responsibility: render a Fluent UI v9 Menu button that, on
 * each format selection, hands the rows + filename to the matching
 * helper from [web/src/utils/csv-export.ts](../../utils/csv-export.ts).
 *
 * Why a primitive (not a hook): every list surface (UsersTab,
 * GroupsTab, LogsTab, ActivityTab, OperationsPage, BulkTab) needs
 * the same UX in the toolbar - one button, three formats, one menu.
 * Wrapping the Menu + 3 handlers + filename-timestamping in a
 * primitive keeps each consumer to a single `<ExportSplitButton>`
 * line so there is one place to evolve the format set, the
 * timestamp convention, or the button styling.
 *
 * @see docs/PHASE_N3_EXPORT_EVERYWHERE.md (next commit will create)
 * @see web/src/components/primitives/ExportSplitButton.test.tsx (TDD spec)
 */
import React from 'react';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { ArrowDownloadRegular } from '@fluentui/react-icons';
import {
  toCsv,
  toJson,
  toNdjson,
  triggerCsvDownload,
  triggerJsonDownload,
  triggerNdjsonDownload,
} from '../../utils/csv-export';

export interface ExportSplitButtonProps {
  /**
   * The rows to serialise. Pass EITHER `rows` (eager) OR `getRows`
   * (lazy, called at click-time so heavy serialisation cost is paid
   * only when the operator actually clicks Export).
   */
  rows?: ReadonlyArray<Record<string, unknown>>;
  getRows?: () => ReadonlyArray<Record<string, unknown>>;
  /**
   * Filename prefix - the primitive appends `-YYYYMMDDTHHMMSSZ.<fmt>`
   * so two clicks within a second do not collide on disk.
   */
  filenameBase: string;
  /**
   * Optional column pin for CSV. JSON + NDJSON ignore this and emit
   * the full row shape.
   */
  columns?: readonly string[];
}

/**
 * Format the current UTC time as `YYYYMMDDTHHMMSSZ` (sortable, no
 * separators that would break a filename on any OS).
 */
function utcStampForFilename(): string {
  return new Date()
    .toISOString()
    .replace(/[-:.]/g, '')
    .replace(/\d{3}Z$/, 'Z');
}

/**
 * Resolve the rows source - eager `rows` prop wins over lazy
 * `getRows` callback when both are provided (callers should pick one
 * per usage; defensive ordering only).
 */
function resolveRows(
  rows: ExportSplitButtonProps['rows'],
  getRows: ExportSplitButtonProps['getRows'],
): ReadonlyArray<Record<string, unknown>> {
  if (rows !== undefined) return rows;
  if (getRows !== undefined) return getRows();
  return [];
}

export const ExportSplitButton: React.FC<ExportSplitButtonProps> = ({
  rows,
  getRows,
  filenameBase,
  columns,
}) => {
  // For the disabled-state contract we need to know if there is at
  // least one row. With the lazy `getRows` variant we trust the
  // caller to only mount the button when it has rows; eager `rows`
  // can be inspected directly.
  const eagerEmpty = rows !== undefined && rows.length === 0;

  const onCsv = React.useCallback(() => {
    const resolved = resolveRows(rows, getRows);
    const csv = toCsv(resolved, columns ? { columns } : undefined);
    triggerCsvDownload(`${filenameBase}-${utcStampForFilename()}.csv`, csv);
  }, [rows, getRows, filenameBase, columns]);

  const onJson = React.useCallback(() => {
    const resolved = resolveRows(rows, getRows);
    const json = toJson(resolved);
    triggerJsonDownload(`${filenameBase}-${utcStampForFilename()}.json`, json);
  }, [rows, getRows, filenameBase]);

  const onNdjson = React.useCallback(() => {
    const resolved = resolveRows(rows, getRows);
    const ndjson = toNdjson(resolved);
    triggerNdjsonDownload(`${filenameBase}-${utcStampForFilename()}.ndjson`, ndjson);
  }, [rows, getRows, filenameBase]);

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          icon={<ArrowDownloadRegular />}
          appearance="secondary"
          disabled={eagerEmpty}
          data-testid="export-button"
        >
          Export
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem data-testid="export-menu-csv" onClick={onCsv}>
            CSV
          </MenuItem>
          <MenuItem data-testid="export-menu-json" onClick={onJson}>
            JSON
          </MenuItem>
          <MenuItem data-testid="export-menu-ndjson" onClick={onNdjson}>
            NDJSON
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};
