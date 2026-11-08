import { toast } from 'sonner';
import type { Item, SubmitProposalResult } from '../../../shared/types';
import { students } from './format';

/** Thank the student and say plainly what happens to their report. */
export function announceSubmission(result: SubmitProposalResult, item: Item | undefined) {
  const name = item?.name ?? 'this item';
  const helped =
    result.weeklySearches > 0 ? `You just helped ${students(result.weeklySearches)} who search ${name} each week.` : 'Thanks for sharing.';
  switch (result.outcome) {
    case 'live':
      toast.success('Price is live for everyone', { description: `It matched another student's report. ${helped}` });
      break;
    case 'reconfirmed':
      toast.success('Price confirmed', { description: `Same as the price on the map, so it's now fresher. ${helped}` });
      break;
    case 'strengthened':
      toast.success('Shelf and checkout prices match', {
        description: `Your report now needs just one other student to confirm. ${helped}`,
      });
      break;
    case 'held':
      toast('Waiting for extra review', {
        description: `That's far from the usual campus price, so ${students(result.required)} need to check it. ${helped}`,
      });
      break;
    default:
      toast('Waiting for confirmation', {
        description: `It goes live once ${result.required === 1 ? 'one other student confirms' : `${result.required} other students confirm`}. ${helped}`,
      });
  }
}
