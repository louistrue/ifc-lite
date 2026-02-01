/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCFPanel - BIM Collaboration Format issue management panel
 *
 * Provides:
 * - Topic list with filtering
 * - Topic detail view with comments
 * - Viewpoint thumbnails with activation
 * - Create/edit topics and comments
 * - Import/export BCF files
 */

import React, { useCallback, useState, useMemo, useRef } from 'react';
import {
  X,
  Plus,
  MessageSquare,
  Camera,
  Upload,
  Download,
  ChevronLeft,
  Send,
  Trash2,
  Edit2,
  User,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Filter,
  MousePointer2,
  Focus,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useViewerStore } from '@/store';
import type { BCFTopic, BCFComment, BCFViewpoint } from '@ifc-lite/bcf';
import {
  readBCF,
  writeBCF,
  createBCFProject,
  createBCFTopic,
  createBCFComment,
} from '@ifc-lite/bcf';
import { useBCF } from '@/hooks/useBCF';

// ============================================================================
// Constants
// ============================================================================

const TOPIC_TYPES = ['Issue', 'Request', 'Comment', 'Error', 'Warning', 'Info'];
const TOPIC_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const PRIORITIES = ['High', 'Medium', 'Low'];

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({ status }: { status?: string }) {
  const variant = useMemo(() => {
    switch (status?.toLowerCase()) {
      case 'open':
        return 'default';
      case 'in progress':
        return 'secondary';
      case 'resolved':
      case 'closed':
        return 'outline';
      default:
        return 'default';
    }
  }, [status]);

  const Icon = useMemo(() => {
    switch (status?.toLowerCase()) {
      case 'open':
        return AlertCircle;
      case 'in progress':
        return Clock;
      case 'resolved':
      case 'closed':
        return CheckCircle;
      default:
        return AlertCircle;
    }
  }, [status]);

  return (
    <Badge variant={variant} className="text-xs gap-1">
      <Icon className="h-3 w-3" />
      {status || 'Open'}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  const colorClass = useMemo(() => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default:
        return '';
    }
  }, [priority]);

  if (!priority) return null;

  return (
    <Badge variant="outline" className={`text-xs ${colorClass}`}>
      {priority}
    </Badge>
  );
}

function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function formatDateTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

// ============================================================================
// Topic List View
// ============================================================================

interface TopicListProps {
  topics: BCFTopic[];
  onSelectTopic: (topicId: string) => void;
  onCreateTopic: () => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  author: string;
  onSetAuthor: (author: string) => void;
}

function TopicList({
  topics,
  onSelectTopic,
  onCreateTopic,
  statusFilter,
  onStatusFilterChange,
  author,
  onSetAuthor,
}: TopicListProps) {
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState(author);
  const isDefaultEmail = author === 'user@example.com';

  const handleSaveEmail = useCallback(() => {
    if (emailInput.trim() && emailInput.includes('@')) {
      onSetAuthor(emailInput.trim());
      setEditingEmail(false);
    }
  }, [emailInput, onSetAuthor]);
  const filteredTopics = useMemo(() => {
    if (!statusFilter || statusFilter === 'all') return topics;
    return topics.filter(
      (t) => t.topicStatus?.toLowerCase() === statusFilter.toLowerCase()
    );
  }, [topics, statusFilter]);

  // Sort by creation date (newest first)
  const sortedTopics = useMemo(() => {
    return [...filteredTopics].sort(
      (a, b) => new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime()
    );
  }, [filteredTopics]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TOPIC_STATUSES.map((status) => (
              <SelectItem key={status} value={status.toLowerCase()}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={onCreateTopic}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Topic List */}
      <ScrollArea className="flex-1">
        {sortedTopics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-muted-foreground text-sm">
            <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
            <p>No topics</p>
            <Button
              variant="link"
              size="sm"
              onClick={onCreateTopic}
              className="mt-1"
            >
              Create first topic
            </Button>

            {/* Email setup nudge */}
            <div className="mt-6 w-full max-w-xs">
              <div className="border border-border rounded-lg p-3 bg-muted/30">
                {editingEmail ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Your email for BCF authorship</Label>
                    <Input
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="your@email.com"
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEmail();
                        if (e.key === 'Escape') setEditingEmail(false);
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEmailInput(author);
                          setEditingEmail(false);
                        }}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveEmail}
                        disabled={!emailInput.trim() || !emailInput.includes('@')}
                        className="h-7 text-xs"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">Author</p>
                      <p className={`text-sm truncate ${isDefaultEmail ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                        {author}
                      </p>
                    </div>
                    <Button
                      variant={isDefaultEmail ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setEmailInput(author);
                        setEditingEmail(true);
                      }}
                      className="h-7 text-xs shrink-0"
                    >
                      {isDefaultEmail ? 'Set email' : <Edit2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
              </div>
              {isDefaultEmail && !editingEmail && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Set your email to identify your issues and comments
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedTopics.map((topic) => (
              <button
                key={topic.guid}
                onClick={() => onSelectTopic(topic.guid)}
                className="w-full text-left p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="font-medium text-sm line-clamp-1 flex-1">
                    {topic.title}
                  </h4>
                  <StatusBadge status={topic.topicStatus} />
                </div>
                {topic.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {topic.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PriorityBadge priority={topic.priority} />
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {topic.creationAuthor.split('@')[0]}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(topic.creationDate)}
                  </span>
                  {topic.comments.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {topic.comments.length}
                    </span>
                  )}
                  {topic.viewpoints.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Camera className="h-3 w-3" />
                      {topic.viewpoints.length}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Topic Detail View
// ============================================================================

interface TopicDetailProps {
  topic: BCFTopic;
  onBack: () => void;
  onAddComment: (text: string, viewpointGuid?: string) => void;
  onAddViewpoint: () => void;
  onActivateViewpoint: (viewpoint: BCFViewpoint) => void;
  onDeleteViewpoint: (viewpointGuid: string) => void;
  onUpdateStatus: (status: string) => void;
  onDeleteTopic: () => void;
  // Viewer state info for capture feedback
  selectionCount: number;
  hasIsolation: boolean;
  hasHiddenEntities: boolean;
}

function TopicDetail({
  topic,
  onBack,
  onAddComment,
  onAddViewpoint,
  onActivateViewpoint,
  onDeleteViewpoint,
  onUpdateStatus,
  onDeleteTopic,
  selectionCount,
  hasIsolation,
  hasHiddenEntities,
}: TopicDetailProps) {
  const [commentText, setCommentText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedViewpointGuid, setSelectedViewpointGuid] = useState<string | null>(null);

  // Get the selected viewpoint for display
  const selectedViewpoint = useMemo(() => {
    if (!selectedViewpointGuid) return null;
    return topic.viewpoints.find(vp => vp.guid === selectedViewpointGuid) || null;
  }, [selectedViewpointGuid, topic.viewpoints]);

  const handleSubmitComment = useCallback(() => {
    if (commentText.trim()) {
      // Associate comment with selected viewpoint if one is selected
      onAddComment(commentText.trim(), selectedViewpointGuid || undefined);
      setCommentText('');
      setSelectedViewpointGuid(null); // Clear selection after commenting
    }
  }, [commentText, onAddComment, selectedViewpointGuid]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmitComment();
      }
    },
    [handleSubmitComment]
  );

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-medium text-sm flex-1 truncate">{topic.title}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Topic Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={topic.topicStatus || 'Open'} onValueChange={onUpdateStatus}>
                <SelectTrigger className="h-7 w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPIC_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PriorityBadge priority={topic.priority} />
              {topic.topicType && (
                <Badge variant="outline" className="text-xs">
                  {topic.topicType}
                </Badge>
              )}
            </div>

            {topic.description && (
              <p className="text-sm text-muted-foreground">{topic.description}</p>
            )}

            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Created by {topic.creationAuthor} on{' '}
                {formatDateTime(topic.creationDate)}
              </p>
              {topic.assignedTo && <p>Assigned to: {topic.assignedTo}</p>}
              {topic.dueDate && <p>Due: {formatDate(topic.dueDate)}</p>}
            </div>
          </div>

          <Separator />

          {/* Viewpoints */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Viewpoints</h4>
              <Button variant="outline" size="sm" onClick={onAddViewpoint}>
                <Camera className="h-3 w-3 mr-1" />
                Capture
              </Button>
            </div>

            {/* Capture info - what will be included */}
            {(selectionCount > 0 || hasIsolation || hasHiddenEntities) && (
              <div className="mb-2 p-2 bg-muted/50 rounded-md text-xs text-muted-foreground">
                <p className="font-medium mb-1">Capture will include:</p>
                <ul className="space-y-0.5">
                  {selectionCount > 0 && (
                    <li className="flex items-center gap-1">
                      <MousePointer2 className="h-3 w-3" />
                      {selectionCount} selected {selectionCount === 1 ? 'object' : 'objects'}
                    </li>
                  )}
                  {hasIsolation && (
                    <li className="flex items-center gap-1">
                      <Focus className="h-3 w-3" />
                      Isolated objects (others hidden)
                    </li>
                  )}
                  {hasHiddenEntities && !hasIsolation && (
                    <li className="flex items-center gap-1">
                      <EyeOff className="h-3 w-3" />
                      Hidden objects
                    </li>
                  )}
                </ul>
              </div>
            )}

            {topic.viewpoints.length === 0 ? (
              <p className="text-xs text-muted-foreground">No viewpoints captured</p>
            ) : (
              <div className="space-y-2">
                {topic.viewpoints.map((vp) => {
                  const isSelected = selectedViewpointGuid === vp.guid;
                  const commentCount = topic.comments.filter(c => c.viewpointGuid === vp.guid).length;
                  return (
                    <div
                      key={vp.guid}
                      className={`rounded-md overflow-hidden border-2 transition-colors ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      {/* Snapshot */}
                      <div className="relative group">
                        {vp.snapshot ? (
                          <img
                            src={vp.snapshot}
                            alt="Viewpoint"
                            className="w-full aspect-video object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => onActivateViewpoint(vp)}
                          />
                        ) : (
                          <div
                            className="w-full aspect-video bg-muted flex items-center justify-center cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => onActivateViewpoint(vp)}
                          >
                            <Camera className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        {/* Delete button - hover only */}
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteViewpoint(vp.guid);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {/* Action bar - always visible */}
                      <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30">
                        <Button
                          variant={isSelected ? 'default' : 'ghost'}
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => setSelectedViewpointGuid(isSelected ? null : vp.guid)}
                        >
                          <MessageSquare className="h-3 w-3" />
                          {commentCount > 0 ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Comment'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onActivateViewpoint(vp)}
                        >
                          Go to view
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Comments */}
          <div>
            <h4 className="text-sm font-medium mb-2">
              Comments ({topic.comments.length})
            </h4>

            <div className="space-y-3">
              {topic.comments.map((comment) => {
                // Find associated viewpoint if any
                const associatedViewpoint = comment.viewpointGuid
                  ? topic.viewpoints.find(vp => vp.guid === comment.viewpointGuid)
                  : null;
                return (
                  <div
                    key={comment.guid}
                    className="bg-muted/50 rounded-md p-2 text-sm"
                  >
                    {/* Show associated viewpoint thumbnail if present */}
                    {associatedViewpoint?.snapshot && (
                      <div
                        className="mb-2 rounded overflow-hidden border border-border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => onActivateViewpoint(associatedViewpoint)}
                      >
                        <img
                          src={associatedViewpoint.snapshot}
                          alt="Associated viewpoint"
                          className="w-full h-16 object-cover"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{comment.author.split('@')[0]}</span>
                      <span>-</span>
                      <span>{formatDateTime(comment.date)}</span>
                      {comment.viewpointGuid && (
                        <span className="flex items-center gap-0.5">
                          <Camera className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{comment.comment}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Comment Input */}
      <div className="border-t border-border p-3">
        {/* Show selected viewpoint indicator */}
        {selectedViewpoint && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-primary/10 rounded-md">
            {selectedViewpoint.snapshot && (
              <img
                src={selectedViewpoint.snapshot}
                alt="Selected viewpoint"
                className="w-10 h-10 object-cover rounded"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Commenting on viewpoint</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setSelectedViewpointGuid(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder={selectedViewpoint ? "Add comment on viewpoint..." : "Add a comment..."}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button size="icon" onClick={handleSubmitComment} disabled={!commentText.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/90 flex items-center justify-center p-4">
          <div className="bg-card border rounded-lg p-4 max-w-xs">
            <h4 className="font-medium mb-2">Delete Topic?</h4>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete this topic and all its comments and viewpoints.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDeleteTopic();
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Create Topic Dialog
// ============================================================================

interface CreateTopicFormProps {
  onSubmit: (topic: Partial<BCFTopic>) => void;
  onCancel: () => void;
  author: string;
}

function CreateTopicForm({ onSubmit, onCancel, author }: CreateTopicFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicType, setTopicType] = useState('Issue');
  const [priority, setPriority] = useState('Medium');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (title.trim()) {
        onSubmit({
          title: title.trim(),
          description: description.trim() || undefined,
          topicType,
          priority,
        });
      }
    },
    [title, description, topicType, priority, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">New Topic</h3>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Brief description of the issue"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Detailed description (optional)"
          className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={topicType} onValueChange={setTopicType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOPIC_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          Create Topic
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// Main BCF Panel Component
// ============================================================================

interface BCFPanelProps {
  onClose: () => void;
}

export function BCFPanel({ onClose }: BCFPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store state
  const bcfProject = useViewerStore((s) => s.bcfProject);
  const setBcfProject = useViewerStore((s) => s.setBcfProject);
  const activeTopicId = useViewerStore((s) => s.activeTopicId);
  const setActiveTopic = useViewerStore((s) => s.setActiveTopic);
  const addTopic = useViewerStore((s) => s.addTopic);
  const updateTopic = useViewerStore((s) => s.updateTopic);
  const deleteTopic = useViewerStore((s) => s.deleteTopic);
  const addComment = useViewerStore((s) => s.addComment);
  const addViewpoint = useViewerStore((s) => s.addViewpoint);
  const deleteViewpoint = useViewerStore((s) => s.deleteViewpoint);
  const bcfAuthor = useViewerStore((s) => s.bcfAuthor);
  const setBcfAuthor = useViewerStore((s) => s.setBcfAuthor);
  const setBcfLoading = useViewerStore((s) => s.setBcfLoading);

  // Viewer state for capture feedback
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const selectedEntityIds = useViewerStore((s) => s.selectedEntityIds);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);

  // Computed capture state info
  const selectionCount = useMemo(() => {
    let count = selectedEntityId !== null ? 1 : 0;
    count += selectedEntityIds.size;
    if (selectedEntityId !== null && selectedEntityIds.has(selectedEntityId)) {
      count--; // Avoid double-counting
    }
    return count;
  }, [selectedEntityId, selectedEntityIds]);
  const hasIsolation = isolatedEntities !== null && isolatedEntities.size > 0;
  const hasHiddenEntities = hiddenEntities.size > 0;
  const setBcfError = useViewerStore((s) => s.setBcfError);
  const models = useViewerStore((s) => s.models);

  // BCF hook for camera/snapshot integration
  const { createViewpointFromState, applyViewpoint } = useBCF();

  // Local state
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAuthorDialog, setShowAuthorDialog] = useState(false);
  const [tempAuthor, setTempAuthor] = useState(bcfAuthor);

  // Get topics list
  const topics = useMemo(() => {
    if (!bcfProject) return [];
    return Array.from(bcfProject.topics.values());
  }, [bcfProject]);

  // Get active topic
  const activeTopic = useMemo(() => {
    if (!bcfProject || !activeTopicId) return null;
    return bcfProject.topics.get(activeTopicId) || null;
  }, [bcfProject, activeTopicId]);

  // Get a default project name from loaded models
  const getDefaultProjectName = useCallback(() => {
    if (models.size === 0) {
      // No models loaded, use date-based name
      const date = new Date().toISOString().split('T')[0];
      return `BCF_Issues_${date}`;
    }
    // Use first model's name (without extension) + "_Issues"
    const firstModel = models.values().next().value;
    if (firstModel?.name) {
      const baseName = firstModel.name.replace(/\.(ifc|ifczip)$/i, '');
      return `${baseName}_Issues`;
    }
    return `BCF_Issues_${new Date().toISOString().split('T')[0]}`;
  }, [models]);

  // Initialize project if needed
  const ensureProject = useCallback(() => {
    if (!bcfProject) {
      setBcfProject(createBCFProject({ name: getDefaultProjectName() }));
    }
  }, [bcfProject, setBcfProject, getDefaultProjectName]);

  // Import BCF file
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setBcfLoading(true);
      setBcfError(null);
      const project = await readBCF(file);
      setBcfProject(project);
    } catch (error) {
      console.error('Failed to import BCF:', error);
      setBcfError(error instanceof Error ? error.message : 'Failed to import BCF file');
    } finally {
      setBcfLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [setBcfProject, setBcfLoading, setBcfError]);

  // Export BCF file
  const handleExport = useCallback(async () => {
    if (!bcfProject) return;

    try {
      setBcfLoading(true);
      const blob = await writeBCF(bcfProject);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use project name, or generate from model name, or date-based fallback
      const fileName = bcfProject.name || getDefaultProjectName();
      a.download = `${fileName}.bcfzip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export BCF:', error);
      setBcfError(error instanceof Error ? error.message : 'Failed to export BCF file');
    } finally {
      setBcfLoading(false);
    }
  }, [bcfProject, setBcfLoading, setBcfError, getDefaultProjectName]);

  // Create new topic
  const handleCreateTopic = useCallback(
    (data: Partial<BCFTopic>) => {
      ensureProject();
      const topic = createBCFTopic({
        title: data.title || 'Untitled',
        description: data.description,
        author: bcfAuthor,
        topicType: data.topicType,
        topicStatus: 'Open',
        priority: data.priority,
      });
      addTopic(topic);
      setShowCreateForm(false);
    },
    [ensureProject, bcfAuthor, addTopic]
  );

  // Add comment to topic (optionally associated with a viewpoint)
  const handleAddComment = useCallback(
    (text: string, viewpointGuid?: string) => {
      if (!activeTopicId) return;
      const comment = createBCFComment({
        author: bcfAuthor,
        comment: text,
        viewpointGuid, // Associate with viewpoint if provided
      });
      addComment(activeTopicId, comment);
    },
    [activeTopicId, bcfAuthor, addComment]
  );

  // Capture viewpoint from current viewer state
  const handleCaptureViewpoint = useCallback(async () => {
    if (!activeTopicId) return;

    // Create viewpoint from current camera, section plane, and selection state
    const viewpoint = await createViewpointFromState({
      includeSnapshot: true,
      includeSelection: true,
      includeHidden: true,
    });

    if (viewpoint) {
      addViewpoint(activeTopicId, viewpoint);
    } else {
      console.warn('[BCFPanel] Failed to capture viewpoint - no camera available');
    }
  }, [activeTopicId, addViewpoint, createViewpointFromState]);

  // Activate viewpoint - apply camera and state to viewer
  const handleActivateViewpoint = useCallback((viewpoint: BCFViewpoint) => {
    applyViewpoint(viewpoint, true); // Animate to viewpoint
  }, [applyViewpoint]);

  // Delete viewpoint
  const handleDeleteViewpoint = useCallback(
    (viewpointGuid: string) => {
      if (!activeTopicId) return;
      deleteViewpoint(activeTopicId, viewpointGuid);
    },
    [activeTopicId, deleteViewpoint]
  );

  // Update topic status
  const handleUpdateStatus = useCallback(
    (status: string) => {
      if (!activeTopicId) return;
      updateTopic(activeTopicId, { topicStatus: status, modifiedAuthor: bcfAuthor });
    },
    [activeTopicId, updateTopic, bcfAuthor]
  );

  // Delete topic
  const handleDeleteTopic = useCallback(() => {
    if (!activeTopicId) return;
    deleteTopic(activeTopicId);
    setActiveTopic(null);
  }, [activeTopicId, deleteTopic, setActiveTopic]);

  // Save author
  const handleSaveAuthor = useCallback(() => {
    if (tempAuthor.trim()) {
      setBcfAuthor(tempAuthor.trim());
    }
    setShowAuthorDialog(false);
  }, [tempAuthor, setBcfAuthor]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <h2 className="font-medium text-sm">BCF Issues</h2>
          {topics.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {topics.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".bcf,.bcfzip"
            onChange={handleImport}
            className="hidden"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
            title="Import BCF"
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleExport}
            disabled={!bcfProject || topics.length === 0}
            title="Export BCF"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setTempAuthor(bcfAuthor);
              setShowAuthorDialog(true);
            }}
            title="Set author"
          >
            <User className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {showCreateForm ? (
          <CreateTopicForm
            onSubmit={handleCreateTopic}
            onCancel={() => setShowCreateForm(false)}
            author={bcfAuthor}
          />
        ) : activeTopic ? (
          <TopicDetail
            topic={activeTopic}
            onBack={() => setActiveTopic(null)}
            onAddComment={handleAddComment}
            onAddViewpoint={handleCaptureViewpoint}
            onActivateViewpoint={handleActivateViewpoint}
            onDeleteViewpoint={handleDeleteViewpoint}
            onUpdateStatus={handleUpdateStatus}
            onDeleteTopic={handleDeleteTopic}
            selectionCount={selectionCount}
            hasIsolation={hasIsolation}
            hasHiddenEntities={hasHiddenEntities}
          />
        ) : (
          <TopicList
            topics={topics}
            onSelectTopic={setActiveTopic}
            onCreateTopic={() => setShowCreateForm(true)}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            author={bcfAuthor}
            onSetAuthor={setBcfAuthor}
          />
        )}

        {/* Author Dialog */}
        {showAuthorDialog && (
          <div className="absolute inset-0 bg-background/90 flex items-center justify-center p-4">
            <div className="bg-card border rounded-lg p-4 w-full max-w-xs">
              <h4 className="font-medium mb-3">Set Author Email</h4>
              <Input
                value={tempAuthor}
                onChange={(e) => setTempAuthor(e.target.value)}
                placeholder="your@email.com"
                className="mb-4"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowAuthorDialog(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveAuthor}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
