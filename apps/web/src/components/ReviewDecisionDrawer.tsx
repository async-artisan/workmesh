import { Suspense, lazy } from 'react';
import { Modal } from './Modal';
import { PageState } from './PageState';

const ReviewDecision = lazy(() =>
  import('../pages/ReviewDecision').then((module) => ({ default: module.ReviewDecision })),
);

/** 工作台签字/审批抽屉：复用决定页的证据与决定逻辑，避免两套权限与票据流程。 */
export function ReviewDecisionDrawer({
  reviewId,
  onClose,
  onDecisionCommitted,
}: {
  reviewId: string | null;
  onClose: () => void;
  /** 决定提交成功后由工作台关闭抽屉并刷新待办列表。 */
  onDecisionCommitted?: () => void;
}) {
  return (
    <Modal
      open={Boolean(reviewId)}
      title="评审决定"
      description="在抽屉里确认证据并签字；提交仍由服务端校验版本与一次性票据。"
      variant="drawer"
      size="lg"
      onClose={onClose}
    >
      {reviewId && (
        <Suspense fallback={<PageState state={{ kind: 'loading' }} title="正在加载评审…" />}>
          <ReviewDecision reviewId={reviewId} embedded onDecisionCommitted={onDecisionCommitted} />
        </Suspense>
      )}
    </Modal>
  );
}
