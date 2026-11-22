/** Plain words for removing someone from a group (feedback-2 ticket 09). Pure: unit-tested under Node. */

export function removeMemberConfirm(name: string, isStandIn: boolean): { title: string; message: string; toast: string } {
  return {
    title: `Remove ${name}?`,
    message: isStandIn
      ? 'Their upcoming turns go to the next people in the rotation.'
      : 'Their upcoming turns go to the next people in the rotation. They can join again with the invite link.',
    toast: `${name} removed`,
  };
}
