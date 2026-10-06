import type { Metadata } from 'next';
import { InterviewHome } from '@/features/interview/InterviewHome';

export const metadata: Metadata = {
  title: 'System design interview practice · ScaleLab',
  description: 'Classic system design problems, graded by running your design at peak traffic and through failures.',
};

export default function InterviewPage() {
  return <InterviewHome />;
}
