---
author:
  name: "@sarah_liu"
  team: "Backend Services"
  avatar: "https://i.pravatar.cc/150?img=28"
title: "优雅的 Go 错误处理模式"
description: "在 Go 1.13+ 中，使用错误包装和类型断言可以实现更优雅的错误处理流程，同时保持良好的错误上下文传递。"
---

```go
func ProcessData(id string) error {
  data, err := FetchData(id)
  if err != nil {
    return fmt.Errorf("fetch data: %w", err)
  }

  // 错误类型检查
  var notFoundErr *NotFoundError
  if errors.As(err, &notFoundErr) {
    return handleNotFound(notFoundErr)
  }
}
```
