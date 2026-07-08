# PinShift

PinShift 是一个极简 iPhone WLOC 定位切换工具。目标只有两个动作：

- 一键修改到地图上选中的位置
- 一键恢复真实定位

第一版只支持 Shadowrocket 和 Stash。页面、模块和脚本都可以放在 GitHub Pages；坐标保存在手机代理软件的本地持久化存储里。

## 原理

1. 手机代理软件启用 PinShift 模块和 MITM。
2. 页面点击“一键修改定位”，访问 `https://gs-loc.apple.com/pinshift/save?...`。
3. 模块拦截这个请求，代理脚本把坐标写入 `$persistentStore`。
4. iOS 触发 `/clls/wloc` 时，代理脚本读取坐标并修改 Apple WLOC 响应。
5. 点击“一键恢复真实定位”会清空坐标，脚本进入透传模式。

## 本地开发

```bash
npm install
npm run dev
```

手机真机测试：

```bash
npm run dev:lan
```

终端会输出类似 `http://192.168.1.x:5191` 的地址。手机和 Mac 在同一 Wi-Fi 下，用手机 Safari 打开即可。

## GitHub Pages 部署

推送到 GitHub 后，仓库里的 GitHub Actions 会自动构建并发布到：

```text
https://win223909.github.io/pinshift/
```

GitHub Pages 版本是 HTTPS，Safari 才能正常请求“当前位置”权限。页面里的模块 URL 也会自动变成 GitHub Pages 地址，例如：

```text
https://win223909.github.io/pinshift/modules/pinshift-stash.stoverride
https://win223909.github.io/pinshift/modules/pinshift-shadowrocket.module
```

模块名称和图标使用同站点资源：

```text
https://win223909.github.io/pinshift/icon.png?v=0.1.7
```

## 真机测试顺序

1. 在 PinShift 页面选择 Shadowrocket 或 Stash。
2. 复制模块 URL，导入代理软件并启用。
3. Stash 首页需要打开“覆写 / 改写 / MitM / 脚本”；Shadowrocket 需要启用模块。
4. 开启 HTTPS 解密 / MITM，信任证书。
5. 确认 MITM hostname 只有：

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

6. 回到 PinShift 页面，在地图上点选位置。
7. 可选：点“当前位置”显示手机浏览器当前位置，或把常用地点保存到“收藏夹”。
8. 点“一键修改定位”。
9. 打开地图 App 或目标 App 触发定位。
10. 回 PinShift 点“状态”，看最近 WLOC 和 Patch 是否成功。
11. 测试结束点“一键恢复真实定位”。

## 注意

这个方法只修改 Apple 网络定位返回，不直接控制 GPS 硬件。iOS 26/27 的 `locationd` 缓存可能导致脚本已经 patch 成功但地图暂时不变，高版本系统可能需要重启设备后才刷新。

“当前位置”按钮依赖浏览器 Geolocation API。iPhone Safari 通常要求页面运行在 HTTPS 安全上下文里，`http://192.168.1.x:5191` 这种局域网测试地址可能无法读取当前位置。正式使用时建议部署到 GitHub Pages / Cloudflare Pages 这类 HTTPS 静态托管；局域网测试阶段可以继续手动选点或使用收藏夹。

如果暂时不部署 HTTPS，也可以用 iOS 快捷指令绕过浏览器定位限制：快捷指令读取“当前位置”，然后打开 PinShift URL，例如：

```text
http://192.168.1.37:5191/?lat=纬度&lon=经度&accuracy=25
```

PinShift 会自动把链接里的坐标填入目标位置。
