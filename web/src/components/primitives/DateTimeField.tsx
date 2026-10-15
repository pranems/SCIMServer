import * as React from 'react';
import { makeStyles } from '@fluentui/react-components';
import { CopyableField } from './CopyableField';
import { formatDateTime, type DateTimeValue } from '../../utils/date-time';

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    verticalAlign: 'middle',
  },
});

export const DateTimeField: React.FC<{
  value: DateTimeValue;
  'data-testid'?: string;
}> = ({ value, 'data-testid': testId }) => {
  const classes = useStyles();
  const { text, iso } = formatDateTime(value);
  if (text === '-') return <span data-testid={testId}>-</span>;
  const content = (
    <CopyableField
      value={text}
      copyValue={typeof value === 'string' ? value : (iso ?? String(value))}
      ariaLabel="Copy timestamp"
      data-testid={testId}
    />
  );
  return iso ? (
    <time dateTime={iso} title={iso} className={classes.root}>
      {content}
    </time>
  ) : (
    <span className={classes.root}>{content}</span>
  );
};
