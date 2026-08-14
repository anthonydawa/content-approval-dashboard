import type { ContentItem, Workspace } from "./types";

export const demoWorkspaces: Workspace[] = [
  { id: "luma", name: "Luma Coffee", initials: "LC", color: "#cb653d" },
  { id: "north", name: "North & Pine", initials: "NP", color: "#47665a" },
];

export const demoContent: ContentItem[] = [
  {
    id: "luma-1", workspace_id: "luma", title: "Slow mornings, better coffee",
    caption: "A little reminder to take your morning slowly. Our house-roasted beans are ready when you are. ☕\n\n#LumaCoffee #SlowMornings #CoffeeRitual",
    media_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1400&q=85",
    media_type: "image", channel: "Instagram", scheduled_for: "Aug 18, 9:00 AM", status: "pending", position: 1,
    comments: [],
  },
  {
    id: "luma-2", workspace_id: "luma", title: "Behind the bar",
    caption: "From first pour to final swirl—here’s a tiny look at the care behind every cup. Save this for your next coffee break.\n\n#BehindTheBar #CoffeeCraft",
    media_url: "https://videos.pexels.com/video-files/2909914/2909914-hd_1920_1080_25fps.mp4",
    media_type: "video", channel: "Instagram Reel", scheduled_for: "Aug 20, 5:30 PM", status: "changes_requested", position: 2,
    comments: [{ id: "comment-1", content_id: "luma-2", author: "Mara", body: "Could we use a brighter opening frame? The caption looks good.", created_at: "2026-08-14T02:15:00Z" }],
  },
  {
    id: "luma-3", workspace_id: "luma", title: "Weekend table",
    caption: "Your weekend table is waiting. Bring a friend, stay for one more cup, and let the afternoon unfold.\n\n#WeekendCoffee #CafeDays",
    media_url: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=1400&q=85",
    media_type: "image", channel: "Facebook", scheduled_for: "Aug 23, 11:00 AM", status: "approved", position: 3,
    comments: [],
  },
  {
    id: "north-1", workspace_id: "north", title: "Made for the long way home",
    caption: "Quiet trails, clean lines, and pieces made to move with you. Meet the new Field Collection.\n\n#NorthAndPine #FieldCollection #EverydayOutside",
    media_url: "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=1400&q=85",
    media_type: "image", channel: "Instagram", scheduled_for: "Aug 19, 8:00 AM", status: "pending", position: 1,
    comments: [],
  },
  {
    id: "north-2", workspace_id: "north", title: "Built to wander",
    caption: "For early starts and unplanned turns. The Ridge Pack keeps the essentials close without slowing you down.",
    media_url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=85",
    media_type: "image", channel: "Facebook", scheduled_for: "Aug 22, 4:00 PM", status: "pending", position: 2,
    comments: [],
  },
];

