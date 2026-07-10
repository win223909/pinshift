# PinShift

[简体中文](README.md) | [English](README.en.md)

PinShift 是一个在 iPhone 上使用的 WLOC 定位切换工具，支持 **Shadowrocket** 和 **Stash**。

打开页面：<https://win223909.github.io/pinshift/>

> PinShift 修改的是 Apple 网络定位返回，不是直接控制 GPS。按钮写入坐标后，还需要重新触发一次 iOS 定位。

页面会根据浏览器语言自动选择中文或 English，也可以通过地图右上角的“中 / EN”随时切换；语言选择只保存在当前浏览器中。

## 三步完成

1. **首次安装模块**：在 PinShift 页面选择 Shadowrocket 或 Stash，复制模块 URL 并导入，同时完成 HTTPS 解密 / MitM 和证书信任。
2. **选择目标位置**：搜索地址、点击地图、拖动标记，或者选择收藏地址。
3. **修改并重新检测**：点击“一键修改定位”，关闭 iPhone“定位服务”约 10 秒，再重新打开并点击“重新检测”。

模块已经安装并正常连接时，以后只需要完成第 2、3 步。

## 第一次安装

### Shadowrocket

1. 在 PinShift 的“首次安装模块”里选择 **Shadowrocket**。
2. 复制模块 URL，在 Shadowrocket 中进入“配置”→“模块”→右上角“+”→“来自 URL”，粘贴并启用模块。
3. 进入“配置”→“本地文件”，点开正在使用的配置。
4. 打开“HTTPS 解密”，按提示安装 Shadowrocket 证书。
5. 到 iPhone“设置”→“通用”→“关于本机”→“证书信任设置”，完全信任 Shadowrocket 证书。
6. 回到 Shadowrocket，重新连接代理，然后回 PinShift 点击“重新检测”。

### Stash

1. 在 PinShift 的“首次安装模块”里选择 **Stash**。
2. 复制模块 URL，在 Stash 中进入“覆写”→“安装覆写”，粘贴并启用。
3. 在 Stash 首页打开“覆写 / 改写 / MitM / 脚本”。
4. 进入 Stash“设置”→“MitM”，安装 CA 证书。
5. 到 iPhone“设置”→“通用”→“VPN 与设备管理”，安装描述文件。
6. 再到“设置”→“通用”→“关于本机”→“证书信任设置”，完全信任 Stash 证书。
7. 回到 Stash 重新连接，然后回 PinShift 点击“重新检测”。

> Shadowsocks 只是节点类型。PinShift 能否生效，关键是 Shadowrocket / Stash 的模块、HTTPS 解密或 MitM，以及证书是否已启用。

## 日常修改定位

1. 保持 Shadowrocket 或 Stash 已连接。
2. 打开 PinShift，搜索地点、点击地图或选择收藏位置。
3. 确认目标坐标后，点击“一键修改定位”。
4. 到 iPhone“设置”关闭“定位服务”，等待约 10 秒，再重新打开。
5. 回到 PinShift，点击“重新检测”。

看到下面三项，才表示修改已经完成：

- “模块连接”显示 **Shadowrocket** 或 **Stash**
- “定位请求”显示最近时间
- “修改结果”显示 **修改成功**

如果显示“等待 iPhone 发起定位”，重新执行第 4、5 步。多次没有成功时，重启 iPhone 后再试。

## 恢复真实定位

1. 点击“一键恢复真实定位”。
2. 关闭并重新打开需要定位的 App。
3. 如果仍显示旧位置，再关闭“定位服务”约 10 秒后重新打开；必要时重启 iPhone。

## 常见问题

### 模块连接显示“尚未检测”

先点击“重新检测”。仍无法连接时，依次确认：

- Shadowrocket / Stash 的代理连接已经打开
- PinShift 模块或覆写已经启用
- HTTPS 解密 / MitM 已经打开
- 证书已经安装并完全信任
- Stash 首页的“覆写 / 改写 / MitM / 脚本”全部打开

### 已写入目标位置，但没有修改成功

这表示代理脚本已经保存坐标，但 iPhone 还没有发起新的 WLOC 定位请求。关闭“定位服务”约 10 秒后重新打开，再点击“重新检测”。

### “当前位置”无法获取

“当前位置”依赖 Safari 网页定位权限。请使用上面的 HTTPS 页面，并到 iPhone 设置中允许 Safari 获取位置。局域网 `http://192.168.1.x` 页面通常无法使用网页定位。

### 收藏地址会不会和别人混在一起

不会。收藏夹保存在当前浏览器的 `localStorage` 中，不会上传到 GitHub，也不会与其他访问者共享。

## 隐私与限制

- 目标坐标保存在手机代理软件的本地持久化存储中。
- 收藏地址只保存在当前浏览器中。
- 地点搜索由 OpenStreetMap / Nominatim 提供，搜索文字会发送给该服务。
- PinShift 只修改 Apple WLOC 网络定位。依赖 GPS、蓝牙、基站或自身风控的 App，结果可能不同。
- 高版本 iOS 可能保留旧定位缓存，因此偶尔需要重新开关定位服务或重启设备。

## 工作原理

1. Shadowrocket / Stash 模块拦截 PinShift 的保存、恢复和状态请求。
2. 代理脚本把目标坐标保存在代理软件本地。
3. iOS 请求 Apple `/clls/wloc` 时，脚本读取目标坐标并修改 WLOC 响应。
4. 点击“一键恢复真实定位”后，脚本清空目标坐标并恢复透传。

PinShift 只处理下面两个域名：

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## 本地开发

```bash
npm install
npm run dev
```

同一 Wi-Fi 下进行手机测试：

```bash
npm run dev:lan
```

终端会显示类似 `http://192.168.1.x:5191` 的地址。局域网页面适合测试模块和选点，但 Safari 网页定位通常需要 HTTPS。

运行完整检查：

```bash
npm test
npx tsc --noEmit
```

## 官方 GitHub Pages

线上页面和模块地址：

```text
https://win223909.github.io/pinshift/
https://win223909.github.io/pinshift/modules/pinshift-shadowrocket.module
https://win223909.github.io/pinshift/modules/pinshift-stash.stoverride
```

当前线上文件发布在 `gh-pages` 分支，源代码保存在 `main` 分支。

## 部署到自己的 GitHub Pages

用户可以把 PinShift 完整部署到自己的 GitHub 账号，不需要 NAS、VPS 或长期运行的服务器。部署后，页面、模块和代理脚本都会使用用户自己的 GitHub Pages 地址。

### 准备工作

- 一个 GitHub 账号
- 本机已经安装 Git 和 Node.js 24 或更高版本
- 建议使用公开仓库；GitHub 免费账号部署私有仓库可能受到套餐限制

### 首次部署

1. 打开 [PinShift 仓库](https://github.com/win223909/pinshift)，点击右上角 **Fork**，把仓库复制到自己的 GitHub 账号。
2. 在自己 Fork 后的仓库页面点击 **Code**，复制仓库地址。
3. 在电脑终端运行下面的命令，把 `<你的用户名>` 和 `<仓库名>` 换成自己的信息：

```bash
git clone https://github.com/<你的用户名>/<仓库名>.git
cd <仓库名>
npm install
npm run deploy:pages
```

`deploy:pages` 会自动读取当前仓库的 `origin`，生成正确的页面和模块地址，并把构建结果发布到该仓库的 `gh-pages` 分支。

4. 打开自己仓库的 **Settings** → **Pages**。
5. 在 **Build and deployment** 中把 **Source** 选择为 **Deploy from a branch**。
6. Branch 选择 **gh-pages**，目录选择 **/(root)**，然后点击 **Save**。
7. 等待 GitHub Pages 显示部署成功。页面地址通常是：

```text
https://<你的用户名>.github.io/<仓库名>/
```

打开自己的 PinShift 页面后，“首次安装模块”中显示的模块 URL 也应该以自己的 GitHub Pages 地址开头。请导入自己的模块 URL，不要继续使用本仓库的官方模块地址。

### 后续更新

先在 GitHub 上同步 Fork，再在本地仓库运行：

```bash
git pull
npm install
npm run deploy:pages
```

### 自部署注意事项

- `npm run deploy:pages` 会完整替换 `gh-pages` 分支，该分支只用于保存构建结果，不要在里面手动存放文件。
- 命令只发布静态文件，不会上传收藏夹、目标坐标或手机代理软件中的数据。
- 如果 Pages 显示 404，先确认发布来源是 `gh-pages` 和 `/(root)`，再等待几分钟刷新。
- 仓库改名后，需要重新运行 `npm run deploy:pages`，让页面路径和模块 URL 一起更新。
- 第一次自部署建议先使用 GitHub 提供的默认 `github.io` 地址，确认页面和模块正常后再考虑自定义域名。
