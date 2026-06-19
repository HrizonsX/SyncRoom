# syncRoom Privacy Policy

Effective date: 2026-06-07

This Privacy Policy applies to the syncRoom browser extension and web room client (the "Project Clients"). It explains what information the Project Clients process, how that information is used, and what controls users have over related data when using synchronized playback, web rooms, optional room voice, temporary Bilibili authorization, and connection diagnostics.

## 1. Types of Information Processed

The Extension only processes information required to provide its core functionality. This mainly includes the following categories:

### 1.1 Personal Information

The Extension may read the display name or username visible on Bilibili pages and use it as the member display name in a sync room so participants can identify who started playback, paused, switched videos, or changed playback speed. For generic HTML5 video pages, the Extension does not read website account profile data for sync purposes.

The Extension does not intentionally collect real names, government ID numbers, email addresses, phone numbers, or mailing addresses.

### 1.2 Web History

The Extension reads the URL of the current supported video page in order to:

- determine whether the current page is a supported Bilibili page or generic HTML5 `<video>` page
- identify the currently shared video
- synchronize the currently shared video across room participants

### 1.3 User Activity

The Extension processes player states and user actions that are directly related to synchronized playback, including:

- play or pause state
- current playback position
- playback speed
- page interaction results related to sync control

This information is used only to provide synchronized playback and is not used for advertising, profiling, or cross-site tracking.

### 1.4 Website Content

The Extension may read limited content from the current video page, such as:

- video title
- video source and page title
- video identifiers such as `bvid` and `cid` on Bilibili pages
- video information associated with the current page

This content is used only to identify and synchronize the current video.

### 1.5 Voice Data

When the server enables LiveKit voice, room members may connect to room voice. The microphone is muted by default. The Extension captures microphone audio only after the user explicitly clicks the mic button and grants browser microphone permission, then sends that audio through the configured LiveKit service to members in the same voice room. The Extension does not persistently store microphone audio locally for the voice feature.

LiveKit is used only for room voice. It is not used to distribute the main shared viewing video. Bilibili playback in the web room is handled by URL playback and the SyncRoom proxy, not by publishing a LiveKit video track.

### 1.6 Temporary Video Site Authorization

When a web room host explicitly uses Bilibili QR or SMS login, the server may temporarily store credential material required for Bilibili API requests, such as cookies, CSRF values, or equivalent tokens. These credentials are kept only in temporary server-side authorization state for the host's room and provider playback flow.

Temporary provider credentials are not written to durable room storage, Admin pages, audit logs, error responses, or member-visible payloads. Room members do not receive the host's Bilibili credentials.

### 1.7 Web Room Text Chat

The web room supports room-scoped text chat. Chat messages are broadcast in real time through the sync server to members in the same room. The server does not persist chat history to a database or durable room store, and the web client keeps messages only for the current page lifecycle. Refreshing the page or restarting the server is not expected to restore previous chat messages.

## 2. How Information Is Used

The Extension uses the information above only for the following purposes:

- identifying the current supported video page and its associated video
- creating, joining, and maintaining synchronized playback rooms
- synchronizing play, pause, playback position, and playback speed between room participants
- transmitting room voice when the user explicitly unmutes the microphone
- broadcasting web room text chat messages in real time
- parsing Bilibili videos, bangumi, or live sources after host authorization
- displaying room state, shared video information, and member display names in the Extension UI
- maintaining connection state, diagnosing connection issues, and improving feature reliability

The Extension does not use this information for:

- advertising
- selling data to third parties
- user profiling unrelated to the core function
- cross-site tracking

## 3. Remote Communication

To provide its features, the Extension may communicate with the following remote endpoints:

### 3.1 Video Site APIs

The Extension may access Bilibili-related APIs to read necessary information such as the currently available display name for the logged-in user. For generic HTML5 video pages, the Extension mainly reads the standard video element, page URL, and page title already present on the page.

### 3.2 Sync Server

The Project Clients connect to a sync server configured or used by the user in order to exchange information required for synchronized playback between room participants, including:

- room state
- currently shared video information
- current playback state
- web room text chat messages
- Bilibili authorization status, parse results, and provider playback descriptors

If you configure a third-party sync server yourself, related data will be sent to that server, and data retention and access control will depend on how that server is deployed and operated.

When the host selects `proxy=true` for Bilibili playback, media manifests or segments may be proxied through the sync server. In that case, the sync server processes the related media requests, Range requests, and traffic metrics. The proxy does not send host cookies or authorization headers to room members, but server operators may observe aggregated proxy request and byte counts.

### 3.3 LiveKit Voice Service

If the sync server enables LiveKit voice, the Extension uses a short-lived voice token issued by the server to connect to the configured LiveKit service. When the user unmutes the microphone, microphone audio is transmitted through that LiveKit service. When the user is muted, microphone audio is not published.

## 4. Local Storage

To provide a continuous user experience, the Extension may store the following information locally in the browser:

- room code
- tokens or session identifiers required to join a room
- member identifier
- display name
- latest room state
- server URL configuration

This information is mainly stored in the browser extension storage area or the web room's browser local storage to preserve session state and restore client state. The web room does not store Bilibili temporary authorization credentials in browser local storage.

## 5. Data Sharing and Disclosure

The Extension does not sell personal data.

The Extension only sends relevant information, to the extent necessary for synchronized playback, to:

- the sync server you connect to
- other participants in the same sync room

Shared information may include:

- display name
- currently shared video information
- current playback state such as play, pause, playback position, and playback speed
- web room text chat messages
- room voice audio when the user explicitly unmutes the microphone

Unless required by law or regulation, the Extension does not actively disclose this information to unrelated third parties.

## 6. Remote Code

The Extension does not download, inject, or execute remote code.

All scripts executed by the Extension are packaged with the Extension and run locally. Communication with remote servers is used only for data transfer and synchronization, not for dynamically loading executable code.

## 7. Data Security

The Extension makes reasonable efforts to protect the security of the information it processes and to reduce the risk of unauthorized access, use, or disclosure. However, no method of network transmission or electronic storage can guarantee absolute security.

If you configure a third-party sync server yourself, the security of related data will also depend on that server's own configuration and operations.

## 8. User Controls

You may control related data in the following ways:

- stop using or uninstall the Extension
- leave the sync room
- clear locally stored Extension data in your browser
- modify or remove the configured sync server URL

## 9. Children's Privacy

The Extension is not specifically directed to children and does not knowingly collect sensitive personal information from children.

## 10. Policy Updates

This Privacy Policy may be updated based on feature changes, legal requirements, or operational needs. The latest version will be published in the project repository:

https://github.com/HrizonsX/SyncRoom

## 11. Contact

If you have any questions, comments, or requests regarding this Privacy Policy, you may contact the project through:

- Project: https://github.com/HrizonsX/SyncRoom
- Issues: https://github.com/HrizonsX/SyncRoom/issues
