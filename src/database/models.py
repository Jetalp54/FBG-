"""
Database Models for Firebase Manager Enterprise Server
PostgreSQL-based models for scalability and performance
"""

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON, ForeignKey, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import uuid

Base = declarative_base()

def generate_uuid():
    return str(uuid.uuid4())

class AppUser(Base):
    __tablename__ = "app_users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default="user", nullable=False)  # admin, it, user
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    profiles = relationship("Profile", back_populates="owner")
    projects = relationship("Project", back_populates="owner")
    campaigns = relationship("Campaign", back_populates="owner")
    
    # Permissions
    permissions = relationship("UserPermission", back_populates="user")

class UserPermission(Base):
    __tablename__ = "user_permissions"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("app_users.id"), nullable=False)
    permission_name = Column(String(100), nullable=False)  # projects, campaigns, etc.
    is_granted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    user = relationship("AppUser", back_populates="permissions")
    
    # Index for fast permission lookups
    __table_args__ = (
        Index('idx_user_permission', 'user_id', 'permission_name'),
    )

class Profile(Base):
    __tablename__ = "profiles"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(String, ForeignKey("app_users.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    owner = relationship("AppUser", back_populates="profiles")
    projects = relationship("ProfileProject", back_populates="profile")

class Project(Base):
    __tablename__ = "projects"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    admin_email = Column(String(255), nullable=False)
    service_account = Column(JSON, nullable=False)  # Firebase service account JSON
    api_key = Column(String(500), nullable=False)
    profile_id = Column(String, ForeignKey("profiles.id"), nullable=True)
    owner_id = Column(String, ForeignKey("app_users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    owner = relationship("AppUser", back_populates="projects")
    profile = relationship("ProfileProject", back_populates="project")
    campaigns = relationship("Campaign", back_populates="project")
    users = relationship("ProjectUser", back_populates="project")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_project_owner', 'owner_id'),
        Index('idx_project_active', 'is_active'),
    )

class ProfileProject(Base):
    __tablename__ = "profile_projects"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    profile_id = Column(String, ForeignKey("profiles.id"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    profile = relationship("Profile", back_populates="projects")
    project = relationship("Project", back_populates="profile")
    
    # Unique constraint
    __table_args__ = (
        Index('idx_profile_project', 'profile_id', 'project_id', unique=True),
    )

class ProjectUser(Base):
    __tablename__ = "project_users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    user_id = Column(String(255), nullable=False)  # Firebase user ID
    email = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    photo_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    project = relationship("Project", back_populates="users")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_project_user_email', 'project_id', 'email'),
        Index('idx_project_user_active', 'project_id', 'is_active'),
    )

class Campaign(Base):
    __tablename__ = "campaigns"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    batch_size = Column(Integer, default=100)
    workers = Column(Integer, default=5)
    template = Column(Text, nullable=True)
    status = Column(String(50), default="draft")  # draft, running, completed, failed
    owner_id = Column(String, ForeignKey("app_users.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    owner = relationship("AppUser", back_populates="campaigns")
    project = relationship("Project", back_populates="campaigns")
    results = relationship("CampaignResult", back_populates="campaign")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_campaign_owner', 'owner_id'),
        Index('idx_campaign_status', 'status'),
        Index('idx_campaign_project', 'project_id'),
    )

class CampaignResult(Base):
    __tablename__ = "campaign_results"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    campaign_id = Column(String, ForeignKey("campaigns.id"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    total_users = Column(Integer, default=0)
    successful = Column(Integer, default=0)
    failed = Column(Integer, default=0)
    errors = Column(JSON, nullable=True)
    start_time = Column(DateTime, default=func.now())
    end_time = Column(DateTime, nullable=True)
    status = Column(String(50), default="running")  # running, completed, failed, partial
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    campaign = relationship("Campaign", back_populates="results")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_campaign_result_campaign', 'campaign_id'),
        Index('idx_campaign_result_status', 'status'),
    )

class DailyCount(Base):
    __tablename__ = "daily_counts"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    date = Column(DateTime, nullable=False)
    count = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_daily_count_project_date', 'project_id', 'date'),
    )

class SMTPConfig(Base):
    __tablename__ = "smtp_configs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    username = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)
    from_email = Column(String(255), nullable=False)
    use_tls = Column(Boolean, default=True)
    security_mode = Column(String(50), default="START_TLS")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("app_users.id"), nullable=True)
    action = Column(String(255), nullable=False)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_audit_log_user', 'user_id'),
        Index('idx_audit_log_action', 'action'),
        Index('idx_audit_log_created', 'created_at'),
    )

class AIKey(Base):
    __tablename__ = "ai_keys"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    service = Column(String(100), nullable=False)  # openai, gemini, mistral, etc.
    key = Column(String(500), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_ai_key_service', 'service'),
    )
