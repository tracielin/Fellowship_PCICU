// Each entry is either a header ({ header: "..." }) or an item ({ id, title }).
// Item ids must be unique and should never change once people have started selecting,
// because selections are stored by id.

export const curriculum = [
  { header: "Section 1" },
  { id: "s1-item-1", title: "Placeholder item 1" },
  { id: "s1-item-2", title: "Placeholder item 2" },
  { id: "s1-item-3", title: "Placeholder item 3" },

  { header: "Section 2" },
  { id: "s2-item-1", title: "Placeholder item 1" },
  { id: "s2-item-2", title: "Placeholder item 2" }
];
