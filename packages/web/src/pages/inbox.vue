<script setup lang="ts">
import type {
	ApprovalRequest,
	ApprovalStatus,
	ModelTemplate,
} from "@agent-manager/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
	CheckCircle2,
	Clock,
	ExternalLink,
	FileText,
	Inbox,
	Loader2,
	XCircle,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { renderMarkdown } from "@/lib/markdown";
import { orpcQuery } from "@/services/orpc";

const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();

// Queries
const { data: approvals, isLoading } = useQuery(
	orpcQuery.listApprovals.queryOptions({
		input: {},
	}),
);

const { data: modelTemplates } = useQuery(
	orpcQuery.listModelTemplates.queryOptions({
		input: {},
		staleTime: 5 * 60 * 1000, // 5 minutes
	}),
);

// Dialog state
const selectedApproval = ref<ApprovalRequest | null>(null);
const isDialogOpen = ref(false);
const isLoadingDetail = ref(false);
const selectedModelId = ref("");

// Computed
const pendingApprovals = computed(() =>
	(approvals.value ?? []).filter((a) => a.status === "pending"),
);

const pastApprovals = computed(() =>
	(approvals.value ?? []).filter((a) => a.status !== "pending"),
);

const availableModels = computed(() =>
	(modelTemplates.value ?? []).filter((m) => m.agentType !== "default"),
);

// Mutations
const approveMutation = useMutation(
	orpcQuery.approveAndExecute.mutationOptions({
		onSuccess: (result) => {
			if (result.success && result.sessionId) {
				isDialogOpen.value = false;
				router.push(`/conversions/${result.sessionId}`);
			}
		},
		onError: (err) => {
			console.error("Failed to approve:", err);
		},
	}),
);

const rejectMutation = useMutation(
	orpcQuery.rejectApproval.mutationOptions({
		onSuccess: () => {
			isDialogOpen.value = false;
			queryClient.invalidateQueries({
				queryKey: orpcQuery.listApprovals.key(),
			});
		},
		onError: (err) => {
			console.error("Failed to reject:", err);
		},
	}),
);

const isProcessing = computed(
	() => approveMutation.isPending.value || rejectMutation.isPending.value,
);

// Helpers
const formatModelLabel = (model: ModelTemplate) => {
	if (!model.agentName || model.name.includes(model.agentName)) {
		return model.name;
	}
	return `${model.name} (${model.agentName})`;
};

const formatDate = (timestamp: number) => {
	return new Date(timestamp).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const getStatusBadge = (status: ApprovalStatus) => {
	switch (status) {
		case "pending":
			return {
				variant: "secondary" as const,
				label: t("inbox.status.pending", "Pending"),
			};
		case "approved":
			return {
				variant: "default" as const,
				label: t("inbox.status.approved", "Approved"),
			};
		case "rejected":
			return {
				variant: "destructive" as const,
				label: t("inbox.status.rejected", "Rejected"),
			};
		case "expired":
			return {
				variant: "outline" as const,
				label: t("inbox.status.expired", "Expired"),
			};
		default:
			return { variant: "outline" as const, label: status };
	}
};

// API calls
const openApprovalDetail = async (item: { id: string }) => {
	isDialogOpen.value = true;
	isLoadingDetail.value = true;
	selectedApproval.value = null;

	try {
		const detail = await orpcQuery.getApproval.call({ id: item.id });
		if (detail) {
			selectedApproval.value = detail;
			// Default to first model
			if (availableModels.value.length > 0 && !selectedModelId.value) {
				selectedModelId.value = availableModels.value[0]!.id;
			}
		}
	} catch (err) {
		console.error("Failed to load approval detail:", err);
	} finally {
		isLoadingDetail.value = false;
	}
};

const handleApprove = () => {
	if (!selectedApproval.value || !selectedModelId.value) return;
	approveMutation.mutate({
		id: selectedApproval.value.id,
		modelId: selectedModelId.value,
	});
};

const handleReject = () => {
	if (!selectedApproval.value) return;
	rejectMutation.mutate({ id: selectedApproval.value.id });
};

const goToConversation = (sessionId: string) => {
	router.push(`/conversions/${sessionId}`);
};

// Watch for dialog close
watch(isDialogOpen, (open) => {
	if (!open) {
		selectedApproval.value = null;
	}
});
</script>

<template>
  <div class="flex flex-col h-full bg-background">
    <!-- Header -->
    <div class="flex items-center gap-3 p-4 border-b shrink-0">
      <Inbox class="size-6" />
      <h1 class="text-2xl font-bold">{{ t('general.inbox', 'Inbox') }}</h1>
      <Badge v-if="pendingApprovals.length > 0" variant="secondary">
        {{ pendingApprovals.length }}
      </Badge>
    </div>

    <!-- Content -->
    <ScrollArea class="flex-1">
      <div class="p-6 space-y-8 max-w-4xl mx-auto">
        <!-- Loading -->
        <div v-if="isLoading" class="space-y-4">
          <Skeleton class="h-24 w-full" />
          <Skeleton class="h-24 w-full" />
          <Skeleton class="h-24 w-full" />
        </div>

        <!-- Empty state -->
        <div
          v-else-if="(approvals ?? []).length === 0"
          class="text-center py-16 text-muted-foreground"
        >
          <Inbox class="size-16 mx-auto mb-4 opacity-20" />
          <h2 class="text-lg font-medium mb-2">
            {{ t('inbox.empty.title', 'No approval requests') }}
          </h2>
          <p class="text-sm">
            {{ t('inbox.empty.description', 'Approval requests from Plan mode will appear here.') }}
          </p>
        </div>

        <template v-else>
          <!-- Pending Approvals -->
          <section v-if="pendingApprovals.length > 0">
            <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock class="size-5 text-yellow-500" />
              {{ t('inbox.pending', 'Pending Approval') }}
            </h2>
            <div class="space-y-3">
              <Card
                v-for="item in pendingApprovals"
                :key="item.id"
                class="cursor-pointer hover:border-primary/50 transition-colors"
                @click="openApprovalDetail(item)"
              >
                <CardHeader class="pb-2">
                  <div class="flex items-start justify-between">
                    <div class="flex items-center gap-2">
                      <FileText class="size-4 text-muted-foreground" />
                      <CardTitle class="text-base">
                        {{ t('inbox.planRequest', 'Plan Approval Request') }}
                      </CardTitle>
                    </div>
                    <div class="flex items-center gap-2">
                      <Badge :variant="getStatusBadge(item.status).variant">
                        {{ getStatusBadge(item.status).label }}
                      </Badge>
                      <span class="text-xs text-muted-foreground">
                        {{ formatDate(item.createdAt) }}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p class="text-sm text-muted-foreground line-clamp-2">
                    {{ item.planSummary }}
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>

          <!-- Past Approvals -->
          <section v-if="pastApprovals.length > 0">
            <h2 class="text-lg font-semibold mb-4 text-muted-foreground">
              {{ t('inbox.history', 'History') }}
            </h2>
            <div class="space-y-3">
              <Card
                v-for="item in pastApprovals"
                :key="item.id"
                class="opacity-70"
              >
                <CardHeader class="pb-2">
                  <div class="flex items-start justify-between">
                    <div class="flex items-center gap-2">
                      <component
                        :is="item.status === 'approved' ? CheckCircle2 : XCircle"
                        :class="[
                          'size-4',
                          item.status === 'approved' ? 'text-green-500' : 'text-red-500'
                        ]"
                      />
                      <CardTitle class="text-base">
                        {{ t('inbox.planRequest', 'Plan Approval Request') }}
                      </CardTitle>
                    </div>
                    <div class="flex items-center gap-2">
                      <Badge :variant="getStatusBadge(item.status).variant">
                        {{ getStatusBadge(item.status).label }}
                      </Badge>
                      <span class="text-xs text-muted-foreground">
                        {{ formatDate(item.updatedAt) }}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="flex items-center justify-between">
                  <p class="text-sm text-muted-foreground line-clamp-1 flex-1">
                    {{ item.planSummary }}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    @click.stop="goToConversation(item.sessionId)"
                  >
                    <ExternalLink class="size-4 mr-1" />
                    {{ t('inbox.view', 'View') }}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        </template>
      </div>
    </ScrollArea>

    <!-- Approval Detail Dialog -->
    <Dialog v-model:open="isDialogOpen">
      <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{{ t('inbox.dialog.title', 'Review Plan') }}</DialogTitle>
          <DialogDescription>
            {{ t('inbox.dialog.description', 'Review the plan and select a model to execute it.') }}
          </DialogDescription>
        </DialogHeader>

        <!-- Loading -->
        <div v-if="isLoadingDetail" class="py-8 flex justify-center">
          <Loader2 class="size-8 animate-spin text-muted-foreground" />
        </div>

        <!-- Content -->
        <template v-else-if="selectedApproval">
          <ScrollArea class="flex-1 min-h-0 max-h-[40vh] border rounded-md">
            <div class="p-4">
              <div
                class="prose dark:prose-invert max-w-none text-sm"
                v-html="renderMarkdown(selectedApproval.planContent)"
              />
            </div>
          </ScrollArea>

          <div class="py-4" v-if="selectedApproval.status === 'pending'">
            <label class="text-sm font-medium mb-2 block">
              {{ t('inbox.dialog.modelLabel', 'Execution Model') }}
            </label>
            <select
              v-model="selectedModelId"
              class="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option
                v-for="model in availableModels"
                :key="model.id"
                :value="model.id"
              >
                {{ formatModelLabel(model) }}
              </option>
            </select>
          </div>
        </template>

        <DialogFooter v-if="selectedApproval?.status === 'pending'">
          <Button
            variant="outline"
            :disabled="isProcessing"
            @click="handleReject"
          >
            <XCircle class="size-4 mr-2" />
            {{ t('inbox.dialog.reject', 'Reject') }}
          </Button>
          <Button
            :disabled="!selectedModelId || isProcessing"
            @click="handleApprove"
          >
            <Loader2 v-if="isProcessing" class="size-4 mr-2 animate-spin" />
            <CheckCircle2 v-else class="size-4 mr-2" />
            {{ t('inbox.dialog.approve', 'Approve & Execute') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
