# Nexora

Nexora is a self-hosted AI chat platform with knowledge graph visualization and conversation memory.
  
## ![alt text](https://github.com/user-attachments/assets/5355d979-e2b3-4613-a6ab-52c9f029a565)

Introduction Website:
https://chat.himpqblog.cn

## Features

- Decouplable email, RAG, and cloud storage components
![alt text](https://github.com/user-attachments/assets/cfb86545-78b9-430a-aa96-9b8ee66a63a4)
- Support for multiple providers including Volcengine, DashScope, OpenAI, and more
![alt text](https://github.com/user-attachments/assets/4bc1a5ea-13bd-44a9-b558-5c7b063a0d7a)
- Knowledge base management with vector databases and file storage
![alt text](https://github.com/user-attachments/assets/1b8054a4-18b8-4d4d-9b91-1992a9129d1a)
- Multiple user support with role-based access control
![alt text](https://github.com/user-attachments/assets/18972ea6-9ef9-42dd-bd3b-f815b3fc2095)
- Multiple function call tools for enhanced capabilities
![alt text](https://github.com/user-attachments/assets/67bba83c-fae3-468d-bb35-155fa6872d5e)

## Components
### NexoraMail 
(https://github.com/Himpq/wMailServer)
NexoraMail is an email service that supports sending and receiving emails. It can be used for user registration, password recovery, and other email-related functions.
It's providing function tools for LLM to send emails, check inbox, and read email content.
To build the NexoraMail component, you may need a 25 port and domain (for Worldwide deployment).
### NexoraDB
NexoraDB is a **Vector Database** based on ChromaDB. It provides vector storage and retrieval capabilities for the knowledge base. It also supports function tools for LLM to manage the knowledge base, including adding, deleting, and searching for knowledge.
You can choose different embedding models by configuring the settings.
### NexoraNetdisk
NexoraNetdisk is a file storage service that supports uploading and downloading files. It can be used for storing files related to the knowledge base, such as documents, images, and other resources.
### NexoraCode
NexoraCode is a Openclaw-liked software that provides code execution, file modifying, local web rendering and other tools for LLM. You can interact with LLM and operate your computers.

It needs a sandbox environment, we haven't planned to do it for now, so please use it with caution and make sure to backup your data regularly.
### ChatDBServer (Nexora)
ChatDBServer is the main chat service. It handles chat UI, tool routing, model access, memory, knowledge integration, and most runtime config.
It is the first component to bring up.

## Installation
```bash
git clone https://github.com/Himpq/Nexora.git
cd Nexora

pip install -r requirements.txt

cd ChatDBServer
python server.py
```

## Component Setup
### ChatDBServer (Nexora)
```bash
cd ChatDBServer
pip install -r requirements.txt
python server.py
```

### NexoraDB
```bash
cd NexoraDB
pip install -r requirements.txt
python app.py
```

### NexoraMail
```bash
cd NexoraMail
pip install -r requirements.txt
python NexoraMail.py
```

### NexoraCode
```bash
cd NexoraCode
pip install -r requirements.txt
python main.py
```

### NexoraNetdisk
Not started yet. Leave it out for now.



## Notice
- You need to configure user accounts in `ChatDBServer/data/user.json`
- This project **does not provide LLM models**, you need to setup with ollama or cloud providers.
- ChatDBServer config details are in `CONFIG.md`

We are not supposed to take the responsibility for any data loss or security issues caused by using this project. Please use it at your own risk and make sure to backup your data regularly.
