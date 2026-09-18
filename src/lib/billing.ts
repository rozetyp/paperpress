import { prisma } from './prisma.js';

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public available: number) {
    super(`insufficient_credits: need ${required}, have ${available}`);
  }
}

export async function chargeCredits(params: {
  userId: string;
  documentId: string;
  amount: number;
  reason: string;
}): Promise<{ remaining: number }> {
  const { userId, documentId, amount, reason } = params;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    });

    if (user.credits < amount) {
      throw new InsufficientCreditsError(amount, user.credits);
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { decrement: amount } },
      select: { credits: true },
    });

    await tx.creditTransaction.create({
      data: { userId, documentId, amount: -amount, reason },
    });

    return { remaining: updated.credits };
  });
}
