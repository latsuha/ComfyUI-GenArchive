# How to publish this node (GitHub Desktop)

Everything needed is already in this folder: `LICENSE`, `pyproject.toml`, `.gitignore`, `.gitattributes`, `README.md`,
`README.uk.md`, `CHANGELOG.md`, `screenshots/`, and an optional Comfy-registry workflow in `.github/workflows`.

## 1. Fill in two placeholders (before the first commit)

Open these files in Notepad (or any editor) and replace the text:

| Placeholder | File | Replace with |
|---|---|---|
| `YOUR_USERNAME` (2 places) | `pyproject.toml` | your GitHub user name |
| `YOUR_USERNAME` (3 places) | `docs/manager-entry.json` | your GitHub user name |
| `YOUR_PUBLISHER_ID` | `pyproject.toml` | leave it for now; you only need it for the Comfy Registry (step 5) |

The license holder in `LICENSE` is "ComfyUI-GenArchive authors"; change it if you prefer your own name.

## 2. Create the repository in GitHub Desktop

1. **File -> Add local repository...** and choose the node folder (`ComfyUI\custom_nodes\ComfyUI-GenArchive`).
2. GitHub Desktop says the folder is not a Git repository -> click **create a repository**.
   Keep the name `ComfyUI-GenArchive`, leave *Git ignore* and *License* on **None** (they already exist), click **Create repository**.
3. On the **Changes** tab you should see the files listed below (about 20). Check that:
   - `screenshots/1_input.png` and `screenshots/2_input.png` (if you have such demo input images) are **not** meant to be published unless you own them,
   - there is no `__pycache__` folder in the list.
4. Type a summary, e.g. `Initial release 1.0.0`, and click **Commit to main**.
5. Click **Publish repository**. Name: `ComfyUI-GenArchive`. Description (suggested):
   *Archive every generated image with its reference images. Fullscreen viewer, regenerate failures with the same references, color correction and retouch from references.*
   **Untick "Keep this code private"**, click **Publish repository**.

## 3. Polish the repository page (github.com)

- **About (gear icon) -> Topics:** `comfyui`, `comfyui-custom-node`, `custom-nodes`, `image-gallery`, `image-viewer`, `image-editing`, `color-correction`, `retouch`.
- **Releases -> Create a new release:** tag `v1.0.0`, title `GenArchive 1.0.0`, text = the 1.0.0 section of `CHANGELOG.md`.

People can already install it by cloning the repository into `ComfyUI/custom_nodes/`.

## 4. ComfyUI-Manager (so people can find it in the search)

Open a pull request to https://github.com/ltdrdata/ComfyUI-Manager that adds the entry from `docs/manager-entry.json`
to `custom-node-list.json` (keep the JSON valid; add it inside the `custom_nodes` list). Once it is merged the node
shows up in the Manager search. (In GitHub Desktop: *Repository -> Open in your browser* for the fork workflow, or use
the web editor on github.com - a pencil icon on the file - and "Propose changes".)

## 5. Comfy Registry (optional, recommended)

1. Create a publisher at https://registry.comfy.org and note the publisher id -> `PublisherId` in `pyproject.toml`.
2. Create an API key there and add it as the repository secret `REGISTRY_ACCESS_TOKEN`
   (github.com -> repository -> Settings -> Secrets and variables -> Actions).
3. github.com -> repository -> Actions -> "Publish to the Comfy registry" -> Run workflow.
   For every new version raise `version` in `pyproject.toml` first.

## Updating later

Edit the files, bump `version` in `pyproject.toml`, add a section to `CHANGELOG.md`, then in GitHub Desktop
**Commit to main** -> **Push origin**, and create a new release on github.com.
