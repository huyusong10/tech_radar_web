---
author:
  name: "@lisa_chen"
  team: "Frontend Engineering"
  avatar: "https://i.pravatar.cc/150?img=47"
title: "React 性能优化实战：虚拟滚动"
description: "在处理超大列表时，通过虚拟滚动技术将渲染性能提升了 10 倍以上。这里分享核心实现思路。"
---

```tsx
const VirtualList = ({ items, height }: Props) => {
  const [scrollTop, setScrollTop] = useState(0);
  const startIdx = Math.floor(scrollTop / ITEM_HEIGHT);
  const endIdx = startIdx + Math.ceil(height / ITEM_HEIGHT);

  return (
    <div onScroll={handleScroll}>
      {items.slice(startIdx, endIdx).map(...)}
    </div>
  );
};
```
